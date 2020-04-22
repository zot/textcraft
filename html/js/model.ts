import protocol from './protocol-shim.js'
import {
    Constructor,
    MudConnection,
    connection,
    activeWorld,
} from './mudcontrol.js'

export let storage: MudStorage

const codeVersion = 1
const jsyaml: any = (window as any).jsyaml
const centralDbName = 'textcraft'
const infoKey = 'info'
const locationIndex = 'locations'
const userThingIndex = 'things'
const linkOwnerIndex = 'linkOwners'
const otherLinkIndex = 'otherLink'
const associationIndex = 'associations'
const basicAssociationIndex = 'basicAssociations'
const prototypeIndex = 'prototypes'
const usersSuffix = ' users'
const extensionsSuffix = ' extensions'
const extensionNameIndex = 'names'
const extensionHashIndex = 'hashes'
const thingIndexes = [prototypeIndex, associationIndex, basicAssociationIndex,
    //obsolete indexes
    locationIndex, linkOwnerIndex, otherLinkIndex]

export type thingId = number

export class Extension {
    id: number
    name: string // human-readable name
    text: string
    hash: string
    succeed: () => void
    onLoggedIn: (user: any, thing: Thing) => void

    constructor(obj: any) {
        Object.assign(this, obj)
    }
    async getHash() {
        return this.hash || (this.hash = toHex(new Int8Array(await crypto.subtle.digest('sha-256', protocol.utfEncoder.encode(this.text)))))
    }
    async populate(file: File) {
        this.name = file.name
        this.text = await (file as any).text()
        return this.getHash()
    }
}

const associationProps = {
    assoc: true,
    assocMany: true,
    assocId: true,
    assocIdMany: true,
    refs: true,
}

type propType = string | number | symbol

function deferredThing(promise: Promise<Thing>, item: propType, path?: propType[]) {
    let thing: Thing | Thing[] = null

    path = path ? path.slice() : []
    path.push(item)
    // tslint:disable-next-line:no-floating-promises
    promise.then(t => thing = t)
    return new Proxy({}, {
        get(obj, prop) {
            if (thing) return thing[prop]
            // every 2nd prop must be an association prop
            if ((path.length % 2 === 1 === prop in associationProps)
                // you have to stop after getting refs
                && !(path.length >= 1 && path[path.length - 2] === 'refs')) {
                return deferredThing(promise.then(t => t[prop]), prop, path)
            }
            throw new Error(`Attempt to use thing before a sync()`)
        },
        set(obj, prop, value) {
            if (thing) {
                thing[prop] = value
            }
            return true
        }
    })
}

function proxify(accessor: any) {
    return new Proxy<AssociationIdAccessor>(accessor, {
        get(obj: AssociationIdAccessor, prop: string | number | symbol) {
            if (prop in obj) return obj[prop]
            return obj.get(String(prop))
        },
        set(obj: AssociationIdAccessor, prop: string | number | symbol, value: any) {
            obj.set(String(prop), value)
            return true
        },
        has(obj: AssociationIdAccessor, prop: string) {
            return obj.has(prop)
        },
        deleteProperty(obj: AssociationIdAccessor, prop: string | number | symbol) {
            obj.dissociateNamed(String(prop))
            return true
        },
    })
}

class AssociationIdAccessor {
    thing: Thing
    many: boolean

    constructor(thing: Thing, many = false) {
        this.thing = thing
        this.many = many
    }
    proxify() { return proxify(this) }
    refsProxy() {
        return new Proxy(this, {
            get(obj, prop: string | number | symbol) {
                if (typeof prop === 'string') {
                    return obj.refs(prop)
                        .then((refs) => {
                            return refs
                        })
                }
            }
        })
    }
    has(prop: string, tid?: thingId | Thing) {
        if (tid === undefined) return typeof this.idNamed(prop) !== 'undefined'
        const id = idFor(tid)

        for (const assoc of this.thing._associations) {
            if (assoc[0] === prop && assoc[1] === id) return true
        }
        return false
    }
    get(prop: string): any {
        return this.selectResult(this.allIdsNamed(prop))
    }
    set(prop: string, tid: thingId | Thing, m2m = false) {
        const id = idFor(tid)

        if (id == null) return this.dissociateNamed(prop)
        this.checkAssociations()
        if (!m2m) this.dissociateNamed(prop, false) // remove all others first if not m2m
        this.thing._associations.push([prop, id])
        this.changedAssociations()
    }
    add(prop: string, tid: thingId | Thing) { this.set(prop, tid, true) }
    refs(prop: string): Promise<Thing[]> {
        return prop ? this.thing.world.getAssociated(prop, this.thing)
            : this.thing.world.getAllAssociated(this.thing)
    }
    allIdsNamed(prop: string, ids: thingId[] = []): thingId[] {
        for (const assoc of this.thing._associations) {
            if (assoc[0] === prop) ids.push(assoc[1])
        }
        return ids
    }
    idNamed(prop: string) {
        for (const assoc of this.thing._associations) {
            if (assoc[0] === prop) return assoc[1] as number
        }
    }
    allNamed(prop: string): Promise<Thing[]> | Thing[] {
        return this.thing.world.getThings(this.allIdsNamed(prop))
    }
    named(prop: string) {
        const id = this.idNamed(prop)

        if (id) return this.thing.world.getThing(id)
    }
    dissociate(prop: string, tid: thingId | Thing) {
        const id = idFor(tid)

        this.checkAssociations()
        for (let i = 0; i < this.thing._associations.length; i++) {
            const assoc = this.thing._associations[i]

            if (assoc[0] === prop && assoc[1] === id) {
                return this.thing._associations.splice(i, 1)
            }
        }
        this.changedAssociations()
    }
    dissociateFrom(tid: thingId | Thing) {
        const id = idFor(tid)

        this.checkAssociations()
        for (let i = 0; i < this.thing._associations.length; i++) {
            const assoc = this.thing._associations[i]

            if (assoc[1] === id) {
                this.thing._associations.splice(i, 1)
            }
        }
        this.changedAssociations()
    }
    dissociateNamed(prop: string, update = true) {
        this.checkAssociations()
        for (let i = 0; i < this.thing._associations.length; i++) {
            const assoc = this.thing._associations[i]

            if (assoc[0] === prop) {
                this.thing._associations.splice(i, 1)
            }
        }
        if (update) this.changedAssociations()
    }
    checkAssociations() {
        if (!this.thing.hasOwnProperty('_associations')) {
            this.thing._associations = this.thing._associations.slice()
        }
    }
    changedAssociations() {
        this.thing._associationThings = Array.from(new Set(this.thing._associations.map(([, v]) => v))) as thingId[]
    }
    selectResult(result: any) {
        return this.many ? result
            : !result || result.length === 0 ? null
                : result.length === 1 ? result[0]
                    : result
    }
}

class AssociationAccessor extends AssociationIdAccessor {
    get(prop: string) {
        const result = this.allNamed(prop)

        return !(result instanceof Promise) ? this.selectResult(result)
            : result.then((r) => this.selectResult(r))
    }
}

/*
 * ## The Thing class
 *
 * The World is made of things, and only things. Each room is a thing. Exits between rooms are things. People are things. Items are things. Boxes are things.
 *
 *  Bill's good friend, Fritz Passow, came up with this idea, which he called "Container MUD", where everything is a container.
 *
 * The Thing class has these properties:
 *
 * * id: an identifying number for this thing, unique among things
 * * name: the name; since this is used in commands, spaces are not allowed
 * * description: the description
 * * location: the thing this is located in -- if this is a link, it has no location
 * * contents: things inside this thing
 * * links: links (which are things) attached to this thing
 * * linkOwner: the thing that owns this link, if this is a link
 * * otherLink: the companion to this link, if this is a link
 */
export class Thing {
    _id: thingId
    _prototype: thingId
    _name: string
    _fullName: string
    _article: string
    _description: string
    _examineFormat: string       // describes an item's contents and links
    _contentsFormat: string      // shown when someone goes into this thing
    _contentsEnterFormat: string // shown to occupants when you move to a container from its location
    _contentsExitFormat: string  // shown to occupants when you move from a container to its location
    _linkFormat: string          // decribes how this item links to its other link
    _linkMoveFormat: string      // shown to someone when they move through a link
    _linkEnterFormat: string     // shown to occupants when someone enters through the link
    _linkExitFormat: string      // shown to occupants when someone leaves through the link
    _keys: thingId[]
    _closed: boolean             // closed objects do not propagate descriptons to their locations
    _priority: number            // whether something will be picked against other, same-named things
    _associations: [string, thingId][] // associations to things
    _associationThings: thingId[]
    _private: thingId            // private to a player, not perceived by others
    world: World
    originalSpec: any
    toasted: boolean
    assoc: any                   // proxy that simplifies association access
    assocMany: any               // proxy that simplifies association access
    assocId: any                 // proxy that simplifies association access
    assocIdMany: any             // proxy that simplifies association access
    refs: any                    // proxy for associations back to this
    specProxy: any
    // standard associations
    //location                   -- if this thing has a location, it is in its location's contents
    //linkOwner                  -- the owner of this link (if this is a link)
    //otherLink                  -- the other link (if this is a link)

    constructor(world: World, id: number, name: string, description?) {
        this.world = world
        this._id = id
        this.fullName = name
        if (typeof description !== 'undefined') this._description = description
        this.makeProxies()
    }
    makeProxies() {
        this.assoc = new AssociationAccessor(this).proxify()
        this.assocMany = new AssociationAccessor(this, true).proxify()
        this.assocId = new AssociationIdAccessor(this).proxify()
        this.assocIdMany = new AssociationIdAccessor(this, true).proxify()
        this.refs = this.assoc.refsProxy()
        this.specProxy = new Proxy(this, {
            get(obj, prop: string | number | symbol) {
                if (typeof prop === 'number' || typeof prop === 'symbol') {
                    throw new Error('You can only get string properties on things')
                }
                if (prop === '_thing') return obj
                if (prop === 'assoc' || prop === 'assocId' || prop === 'refs') {
                    return obj[prop]
                }
                return obj[prop[0] === '!' ? prop : '_' + prop]
            },
            set(obj, prop: string | number | symbol, value: any) {
                if (typeof prop === 'number' || typeof prop === 'symbol') {
                    throw new Error('You can only set string properties on things')
                }
                if (prop === 'associations' || prop === 'associationThings'
                    || prop === 'prototype' || prop === 'id'
                    || prop === 'assoc' || prop === 'assocId' || prop === 'refs') {
                    throw new Error(`You can't set ${prop}`)
                }
                obj[prop[0] === '!' ? prop : '_' + prop] = value
                return true
            }
        })
    }
    get id() { return this._id }
    get article() { return this._article }
    set article(a: string) { this._article = a }
    get name() { return this._name }
    set name(n: string) { this._name = n }
    get fullName() { return this._fullName }
    set fullName(n: string) {
        n = n.trim()
        const [article, name] = findSimpleName(n)

        if (article && n.substring(0, article.length).toLowerCase() === article.toLowerCase()) {
            n = n.substring(article.length).trim()
        }
        if (article) this._article = article
        this._name = escape(name)
        this._fullName = escape(n)
    }
    get description() { return this._description }
    set description(d: string) { this._description = d }
    get contentsFormat() { return this._contentsFormat }
    set contentsFormat(f: string) { this._contentsFormat = f }
    get examineFormat() { return this._examineFormat }
    set examineFormat(f: string) { this._examineFormat = f }
    get linkFormat() { return this._linkFormat }
    set linkFormat(f: string) { this._linkFormat = f }
    getPrototype() { return this.world.getThing(this._prototype) }
    setPrototype(t: Thing) {
        if (t) {
            this._prototype = t.id as thingId
            (this as any).__proto__ = t
        } else {
            this._prototype = null
        }
    }
    isIn(tid: thingId | Thing) { return this.assocId.location === getId(tid) }
    formatName() {
        return (this.article ? this.article + ' ' : '') + this.fullName
    }
    async findConnected() {
        return await this.world.findConnected(this, new Set<Thing>())
    }
    async copy(connected?: Set<Thing>) {
        return this.world.stamp(await this.world.copyThing(this, connected))
    }
    async find(name: string, exclude = new Set([])) {
        let found: Thing

        if (exclude.has(this)) return null
        if (this.name.toLowerCase() === name.toLowerCase()) return this
        exclude.add(this)
        for (const item of await this.refs.location) {
            const result = await item.find(name, exclude)

            if (result && (!found || result._priority > found._priority)) {
                found = result
            }
        }
        if (found) return found
        for (const item of await this.refs.linkOwner) {
            const result = await item.find(name, exclude)

            if (result && (!found || result._priority > found._priority)) {
                found = result
            }
        }
        if (found) return found
        const loc = await this.assoc.location
        if (loc) {
            const result = await loc.find(name, exclude)

            if (result) return result
        }
        const owner = await this.assoc.linkOwner
        if (owner) {
            const result = await owner.find(name, exclude)

            if (result) return result
        }
        return null
    }
    store() {
        return this.world.putThing(this)
    }
    thingEval(args: string, code: string) {
        const realCode = code.match(/[;{}]/) ? code : 'return ' + code

        // tslint:disable-next-line:only-arrow-functions, no-eval
        return eval(`(async function ${args} {
const cmd = this.cmd.bind(this);
const cmdf = this.cmdf.bind(this);
const anyHas = this.anyHas.bind(this);
const findNearby = this.findNearby.bind(this);
const doThings = this.doThings.bind(this);
const me = this.thing.specProxy;
${realCode};
})`)
    }
    setMethod(prop, args, code) {
        const method = this.thingEval(args, code)

        method._code = JSON.stringify([args, code])
        this[prop] = method
    }
    isDirty(spec: any) {
        const original = this.originalSpec
        const keys = new Set(Object.keys(spec))

        if (keys.size !== Object.keys(original).length) return true
        for (const prop of Object.keys(original)) {
            if (!same(original[prop], spec[prop])) {
                return true
            } else {
                keys.delete(prop)
            }
        }
        return keys.size > 0
    }
    spec() {
        const spec = {}

        for (const prop of Object.keys(this)) {
            if (prop[0] === '_') {
                spec[prop.substring(1)] = this[prop]
            } else if (prop[0] === '!') {
                spec[prop] = this[prop]._code
            }
        }
        return spec
    }
    setSpec(spec: any) {
        this.originalSpec = spec
        for (const k of Object.keys(spec)) {
            const value = spec[k]

            if (value && typeof value === 'object') {
                spec[k] = JSON.parse(JSON.stringify(value))
            }
        }
    }
    async useSpec(spec: any) {
        for (const prop of Object.keys(spec)) {
            if (prop[0] === '!') {
                let codeSpec = spec[prop]

                if (Array.isArray(spec[prop])) { // rewrite arrays to strings for faster isDirty
                    spec[prop] = JSON.stringify(codeSpec)
                } else {
                    codeSpec = JSON.parse(spec[prop])
                }
                const [args, code] = codeSpec
                this.setMethod(prop, args, code)
            } else {
                this['_' + prop] = spec[prop]
            }
        }
        // this must be below the above code because setSpec changes spec to avoid aliasing
        this.setSpec(spec)
        if (spec.prototype) {
            const prototype = await this.world.getThing(spec.prototype)

            if (!prototype) {
                throw new Error('Could not find prototype ' + spec.prototype)
            }
            (this as any).__proto__ = prototype
        }
    }
}
Thing.prototype._associations = []

export class World {
    name: string
    storeName: string
    extensionsName: string
    lobby: Thing
    limbo: Thing
    hallOfPrototypes: Thing
    thingProto: Thing   // used by createThing()
    personProto: Thing  // used by authenticate()
    linkProto: Thing
    roomProto: Thing
    generatorProto: Thing
    users: string
    nextId: number
    storage: MudStorage
    thingCache: Map<thingId, Thing>
    txn: IDBTransaction
    thingStore: IDBObjectStore
    userStore: IDBObjectStore
    extensionStore: IDBObjectStore
    defaultUser: string
    activeExtensions = new Map<number, Extension>()
    watcher: (thing: Thing) => void
    clockRate = 2 // seconds between ticks
    mudConnectionConstructor: Constructor<MudConnection>;
    transactionThings: Set<Thing>;
    transactionPromise: Promise<any>;

    constructor(name: string, stg: MudStorage) {
        this.setName(name)
        this.storage = stg
        this.thingCache = new Map()
        this.transactionThings = new Set()
        this.nextId = 0
    }
    async start() {
        for (const extension of await this.getExtensions()) {
            await this.evalExtension(extension)
        }
    }
    async loggedIn() {
        const con = connection

        for (const ext of this.activeExtensions.values()) {
            ext.onLoggedIn(con.user, con.thing)
        }
    }
    close() {
        this.storage.closeWorld(this.name)
    }
    setName(name: string) {
        this.name = name
        this.storeName = mudDbName(name)
        this.users = userDbName(name)
        this.extensionsName = extensionDbName(name)
    }
    initDb() {
        return this.checkDbs(async () => {
            this.limbo = await this.createThing('Limbo', 'You are floating in $this<br>$links<br><br>$contents')
            this.lobby = await this.createThing('Lobby', 'You are in $this')
            this.hallOfPrototypes = await this.createThing('Hall of Prototypes')
            this.thingProto = await this.createThing('thing', 'This is $this')
            this.linkProto = await this.createThing('link', '$This to $link')
            this.roomProto = await this.createThing('room', 'You are in $this')
            this.generatorProto = await this.createThing('generator', 'This is a thing')
            this.personProto = await this.createThing('person', '$This $is only a dude')
            this.limbo.setPrototype(this.roomProto)
            this.limbo._article = ''
            this.lobby.setPrototype(this.roomProto)
            this.generatorProto.setPrototype(this.thingProto)
            this.hallOfPrototypes.setPrototype(this.roomProto)
            this.limbo.assoc.location = this.limbo
            await this.createUser('a', 'a', true)
            this.defaultUser = 'a'
            await this.store()
        })
    }
    async needsDbUpgrade() {
        let anyMissing = false

        if (!storage.db.objectStoreNames.contains(this.storeName)) return true
        const txn = storage.db.transaction(this.storeName)
        const store = txn.objectStore(this.storeName)
        for (const index of thingIndexes) {
            if (!store.indexNames.contains(index)) {
                anyMissing = true
                break
            }
        }
        await promiseFor(txn)
        return anyMissing
    }
    async checkDbs(then: (store: IDBObjectStore, users: IDBObjectStore, txn: IDBTransaction) => Promise<any>, allowIdChange = false) {
        if (!await this.needsDbUpgrade()) {
            return this.doTransaction(then, allowIdChange)
        }
        return new Promise((succeed, fail) => {
            const req = storage.upgrade(async () => {
                succeed(await this.doTransaction(async (store, users, txn) => {
                    return then(store, users, txn)
                }, allowIdChange))
            })

            req.onupgradeneeded = () => {
                const txn = req.transaction
                const db = txn.db
                const userStore = db.objectStoreNames.contains(this.users) ? txn.objectStore(this.users)
                    : db.createObjectStore(this.users, { keyPath: 'name' })
                const thingStore = db.objectStoreNames.contains(this.storeName) ? txn.objectStore(this.storeName)
                    : db.createObjectStore(this.storeName, { keyPath: 'id' })

                checkIndex(userStore, userThingIndex, 'thing', { unique: true })
                checkIndex(thingStore, prototypeIndex, 'prototype', { unique: false })
                checkIndex(thingStore, associationIndex, 'associations', {
                    unique: false,
                    multiEntry: true,
                })
                checkIndex(thingStore, basicAssociationIndex, 'associationThings', {
                    unique: false,
                    multiEntry: true,
                })

                // obsolete indexes
                checkIndex(thingStore, locationIndex, 'location', { unique: false })
                checkIndex(thingStore, linkOwnerIndex, 'linkOwner', { unique: false })
                checkIndex(thingStore, otherLinkIndex, 'otherLink', { unique: false })

            }
            req.onerror = fail
        })
    }
    loadInfo() {
        return this.checkDbs(async (store, users) => {
            this.thingStore = store
            this.userStore = users
            const info = (await promiseFor(store.get('info'))) as any
            if (!info.version || info.version < codeVersion) {
                this.upgrade(info.version, info)
                await doAll(store, async (spec, cursor) => {
                    this.upgrade(info.version, spec) // upgrade things and info in the DB
                    return promiseFor(cursor.update(spec))
                })
            }
            await this.useInfo(info)
        }, true)
    }
    async useInfo(info) {
        this.nextId = info.nextId
        this.defaultUser = info.defaultUser
        this.lobby = await this.getThing(info.lobby)
        this.limbo = await this.getThing(info.limbo)
        this.hallOfPrototypes = await this.getThing(info.hallOfPrototypes)
        this.thingProto = await this.getThing(info.thingProto)
        this.personProto = await this.getThing(info.personProto)
        this.roomProto = (await this.getThing(info.roomProto)) || await this.findPrototype('room')
        this.linkProto = (await this.getThing(info.linkProto)) || await this.findPrototype('link')
        this.generatorProto = (await this.getThing(info.generatorProto)) || await this.findPrototype('generatorProto')
        this.clockRate = info.clockRate || 2
    }
    async findPrototype(name: string) {
        for (const aproto of await this.hallOfPrototypes.refs.location) {
            if (name === aproto.name) return aproto
        }
    }
    async initStdPrototypes() {
        return this.doTransaction(async () => {
            const thingProto = this.thingProto
            const personProto = this.personProto
            const roomProto = this.roomProto
            const linkProto = this.linkProto
            const generatorProto = this.generatorProto

            thingProto.assoc.location = this.hallOfPrototypes
            thingProto.article = 'the'
            thingProto.contentsFormat = '$This $is here'
            thingProto._contentsEnterFormat = '$forme You enters $this from $arg2 $forothers $Arg enters $this from $arg2'
            thingProto._contentsExitFormat = '$forme You leave $this to $arg3 $forothers $Arg leaves $this to $arg3'
            thingProto.examineFormat = 'Exits: $links<br>Contents: $contents'
            thingProto.linkFormat = '$This leads to $link'
            thingProto._priority = 0
            linkProto.assoc.location = this.hallOfPrototypes
            linkProto.article = '';
            (linkProto as any)._locked = false
            linkProto.setMethod('!cmd', '(dir, dest)', `
                if (!dir.locked || anyHas(await findNearby(), 'key', dir)) {
                    return this.cmd('go', dir);
                } else {
                    return this.cmdf('@output $0 "$forme You don\\'t have the key $forothers $Arg tries to go $this to $link but doesn\\'t have the key" me @event me false go $0', dir);
                }
`);
            (linkProto as any)['!go'] = (linkProto as any)['!cmd']
            delete (linkProto as any)._cmd
            delete (linkProto as any)._go
            linkProto._linkEnterFormat = '$Arg1 entered $arg3'
            linkProto._linkMoveFormat = 'You went $name to $arg3'
            linkProto._linkExitFormat = '$Arg1 went $name to $arg3';
            (linkProto as any)._get = `
@output $0 "$forme You can't pick up $this! How is that even possible? $forothers $Arg tries pick up $this, whatever that means..." me @event me false get $0
`
            roomProto.assoc.location = this.hallOfPrototypes
            roomProto._closed = true
            roomProto.setPrototype(thingProto)
            personProto.assoc.location = this.hallOfPrototypes
            personProto.setPrototype(thingProto)
            personProto._article = ''
            personProto.examineFormat = 'Carrying: $contents';
            (personProto as any)._get = `
@output $0 "$forme You cannot pick up $this! $forothers $Arg tries to pick up $this but can't" me @event me false get $0
`
            generatorProto.assoc.location = this.hallOfPrototypes
            generatorProto.setPrototype(thingProto)
            generatorProto._priority = -1;
            (generatorProto as any)._get = `
@quiet;
@copy $0;
@js doThings('$0', '%-1', (orig, cpy)=> cpy.fullName = 'a ' + orig._name);
@reproto %-1 %proto:thing;
@loud;
get %-1
`
        })
    }
    spec() {
        return {
            id: infoKey,
            nextId: this.nextId,
            name: this.name,
            lobby: this.lobby.id,
            limbo: this.limbo.id,
            hallOfPrototypes: this.hallOfPrototypes.id,
            thingProto: this.thingProto.id,
            linkProto: this.linkProto.id,
            roomProto: this.linkProto.id,
            personProto: this.personProto.id,
            generatorProto: this.generatorProto.id,
            defaultUser: this.defaultUser,
            clockRate: this.clockRate,
            version: codeVersion,
        }
    }
    rename(newName) {
        return this.storage.renameWorld(this.name, newName)
    }
    delete() {
        return this.storage.deleteWorld(this.name)
    }
    db() {
        return this.storage.db
    }
    // perform a transaction, then write all dirty things to storage
    async doTransaction(func: (store: IDBObjectStore, users: IDBObjectStore, txn: IDBTransaction) => Promise<any>, allowIdChange = false) {
        if (this.txn) {
            return await this.processTransaction(func)
        } else {
            const oldThingStore = this.thingStore
            const oldUserStore = this.userStore
            const txn = this.db().transaction([this.storeName, this.users], 'readwrite')
            const txnPromise = promiseFor(txn)
            const oldId = this.nextId
            const oldThings = this.transactionThings
            const oldTxnPromise = this.transactionPromise
            let result = null

            this.txn = txn
            this.transactionPromise = txnPromise
            this.thingStore = txn.objectStore(this.storeName)
            this.userStore = txn.objectStore(this.users)
            this.transactionThings = new Set()
            try {
                result = await this.processTransaction(func)
            } finally {
                if (this.transactionThings.size > 0) {
                    //let count = 0

                    for (const thing of this.transactionThings) {
                        if (!thing.toasted) {
                            const spec = thing.spec()

                            if (thing.isDirty(spec)) {
                                //count++
                                thing.setSpec(spec)
                                this.thingStore.put(spec)
                            }
                        }
                    }
                    //console.log(`Wrote ${count} of ${this.transactionThings.size} things`)
                }
                if (oldId !== this.nextId && !allowIdChange) {
                    // tslint:disable-next-line:no-floating-promises
                    this.store()
                }
                await txnPromise
                this.txn = null
                this.thingStore = oldThingStore
                this.userStore = oldUserStore
                this.transactionPromise = oldTxnPromise
                this.transactionThings = oldThings
            }
            return result
        }
    }
    async addExtension(ext: Extension) {
        if (!this.db().objectStoreNames.contains(this.extensionsName)) {
            await new Promise((succeed, fail) => {
                const req = storage.upgrade(succeed)

                req.onerror = fail
                req.onupgradeneeded = () => {
                    const store = req.transaction.db.createObjectStore(this.extensionsName, { autoIncrement: true })
                    store.createIndex(extensionNameIndex, 'name', { unique: false })
                    store.createIndex(extensionHashIndex, 'hash', { unique: true })
                }
            })
        }
        const txn = this.db().transaction([this.extensionsName], 'readwrite')
        const key = await txn.objectStore(this.extensionsName).put(ext, ext.id)
        return promiseFor(txn).then(() => key)
    }
    async removeExtension(id: number) {
        if (!this.db().objectStoreNames.contains(this.extensionsName)) return []
        const txn = this.db().transaction([this.extensionsName], 'readwrite')
        txn.objectStore(this.extensionsName).delete(id)
        return promiseFor(txn)
    }
    async getExtensions(): Promise<Extension[]> {
        if (!this.db().objectStoreNames.contains(this.extensionsName)) return []
        const txn = this.db().transaction([this.extensionsName], 'readwrite')
        const extensionStore = txn.objectStore(this.extensionsName)

        return new Promise((succeed, fail) => {
            const result = []
            const req = extensionStore.openCursor()

            req.onerror = fail
            req.onsuccess = evt => {
                const cursor = (evt.target as any).result

                if (cursor) {
                    const ext = new Extension(cursor.value)

                    ext.id = cursor.key
                    result.push(ext)
                    cursor.continue()
                } else {
                    succeed(result)
                }
            }
        })
    }
    async evalExtension(ext: Extension) {
        const script = document.createElement('script')

        return new Promise((succeed, fail) => {
            this.activeExtensions.set(ext.id, ext)
            ext.succeed = succeed
            document.head.appendChild(script)
            script.setAttribute('type', 'module')
            // this is necessary because we're not getting load events from module script elements
            script.textContent = appendScriptText(ext.text, `window.textcraft.Model.registerExtension(${ext.id}, onStarted, onLoggedIn)`);
            (script as any).loadSuccess = succeed
        }).then(() => console.log('Loaded extension', ext))
    }
    store() {
        return promiseFor(this.thingStore.put(this.spec()))
    }
    async processTransaction(func: (store: IDBObjectStore, users: IDBObjectStore, txn: IDBTransaction) => Promise<any>) {
        return await func(this.thingStore, this.userStore, this.txn)
    }
    getUser(name: string) {
        return this.doTransaction(async (store, users, txn) => await promiseFor(users.get(name)))
    }
    getUserForThing(ti: thingId | Thing) {
        return this.doTransaction(async (store, users, txn) => {
            return promiseFor(users.index(userThingIndex).get(idFor(ti)))
        })
    }
    deleteUser(name: string) {
        return this.doTransaction(async (store, users, txn) => {
            return new Promise((succeed, fail) => {
                const req = users.openCursor(name)

                req.onsuccess = evt => {
                    const cursor = (evt.target as any).result

                    if (cursor) {
                        const dreq = cursor.delete()

                        dreq.onsuccess = succeed
                        dreq.onerror = fail
                    } else {
                        succeed()
                    }
                }
                req.onerror = fail
            })
        })
    }
    async getAllUsers(): Promise<any[]> {
        const userList: any[] = []

        return new Promise((succeed, fail) => {
            return this.doTransaction(async (store, users, txn) => {
                const req = users.openCursor()
                req.onsuccess = evt => {
                    const cursor = (evt.target as any).result

                    if (cursor) {
                        const user = cursor.value

                        user.id = cursor.key
                        userList.push(cursor.value)
                        console.log('found user', cursor.value)
                        cursor.continue()
                    } else {
                        console.log('no more users')
                        succeed(userList)
                    }
                }
                req.onerror = evt => {
                    console.log('failure: ', evt)
                    fail(evt)
                }
            })
        })
    }
    randomUserName() {
        return this.doTransaction(async (store, users, txn) => {
            for (; ;) {
                const name = randomName('user')

                if (!await this.getUser(name)) {
                    return name;
                }
            }
        })
    }
    async createRandomUser() {
        const name = await this.randomUserName()

        return this.createUser(name, randomName('password'), false)
    }
    createUser(name: string, password: string, admin: boolean) {
        return this.doTransaction(async (store, users, txn) => {
            const user = { name, password, admin }

            await this.putUser(user)
            console.log('created user', user)
            return user
        })
    }
    async putUser(user: any) {
        return promiseFor(this.userStore.put(user))
    }
    putThing(thing: Thing) {
        const spec = thing.spec()

        thing.setSpec(spec)
        return promiseFor(this.thingStore.put(spec))
    }
    async replaceUsers(newUsers: any[]) {
        return this.doTransaction(async (store, users, txn) => {
            await deleteAll(users)
            return Promise.all(newUsers.map(u => this.putUser(u)))
        })
    }
    async replaceExtensions(newExtensions: any[]) {
        if (!this.db().objectStoreNames.contains(this.extensionsName)) {
            await new Promise((succeed, fail) => {
                const req = storage.upgrade(succeed)

                req.onerror = fail
                req.onupgradeneeded = () => {
                    const store = req.transaction.db.createObjectStore(this.extensionsName, { autoIncrement: true })
                    store.createIndex(extensionNameIndex, 'name', { unique: false })
                    store.createIndex(extensionHashIndex, 'hash', { unique: true })
                }
            })
        }
        const txn = this.db().transaction([this.extensionsName], 'readwrite')
        const extensions = txn.objectStore(this.extensionsName)
        await deleteAll(extensions)
        for (const ext of newExtensions) {
            extensions.put(ext, ext.id)
        }
        return promiseFor(txn)
    }
    upgrade(fromVersion: number, spec: any) {
        if (!fromVersion) { // upgrade to version 1
            if (spec.id === 'info') {
                spec.version = 1
            } else {
                if (!spec.associations) spec.associations = []
                this.specAssociation(spec, 'location')
                this.specAssociation(spec, 'linkOwner')
                this.specAssociation(spec, 'otherLink')
                for (const key of spec.keys || []) {
                    this.specAssociation(spec, 'key', key, true)
                }
                delete spec.keys
                spec.associationThings = Array.from(new Set(spec.associations.map(([, v]) => v)))
            }
        }
        // more upgrade blocks here will successively upgrade each thing
    }
    specAssociation(spec: any, prop: string, value = spec[prop], m2m = false) {
        if (!m2m) {
            spec.associations = spec.associations.filter(([k]) => k !== prop)
        } else if (spec.associations.find(([k, v]) => k === prop && v === value)) {
            delete spec[prop]
            return
        }
        if (value !== undefined && value !== null) {
            spec.associations.push([prop, value])
        }
        delete spec[prop]
    }
    async replaceThings(newThings: any[]) {
        const info = newThings.find(t => t.id === 'info')
        const version = info.version
        const needUpgrade = !version || version < codeVersion

        await this.doTransaction(async (store, users, txn) => {
            return deleteAll(store)
        })
        return this.doTransaction(async (store, users, txn) => {
            const promises: Promise<any>[] = []

            if (needUpgrade) this.upgrade(version, info)
            for (const thing of newThings) {
                if (needUpgrade) this.upgrade(version, thing)
                promises.push(promiseFor(this.thingStore.put(thing)))
            }
            await Promise.all(promises)
            this.thingCache = new Map()
            this.transactionThings = new Set()
            await this.useInfo(info)
            await this.initStdPrototypes()
            return this.store()
        })
    }
    async getThing(tip: thingId | Thing | Promise<Thing>) {
        const thing = this.basicGetThing(tip)
        return thing instanceof Thing ? thing
            : (this.basicGetThing(tip) as Promise<Thing>).then(t => this.stamp(t))
    }
    basicGetThing(tip: thingId | Thing | Promise<Thing>) {
        let id: thingId

        if (typeof tip === 'number') {
            if (isNaN(tip)) return null
            id = tip
        } else if (tip instanceof Thing) {
            return tip
        } else if (tip instanceof Promise) {
            return tip
        } else {
            return null
        }
        const cached = this.thingCache.get(id)

        if (cached) {
            return cached
        }
        return this.doTransaction(async (store) => {
            return await this.cacheThingFor(await promiseFor(store.get(id)))
        })
    }
    authenticate(name: string, passwd: string, thingName: string, noauthentication = false) {
        return this.doTransaction(async (store, users, txn) => {
            let user: any = await promiseFor(users.get(name))

            if (noauthentication && !user) { // auto-create a user
                user = { name, password: null }
                await this.putUser(user)
                console.log("SET NEW USER ID =", user.id)
            } else if (!(user && (noauthentication || user.password === passwd))) {
                throw new Error('Bad user or password')
            }
            if (!user.thing) {
                const thing = await this.createThing(name)

                thing.assoc.location = this.lobby
                if (this.personProto) thing.setPrototype(this.personProto)
                thing.fullName = thingName || name
                user.thing = thing.id
                await this.putUser(user)
                return [thing, user.admin]
            } else {
                const thing = await this.getThing(user.thing)

                if (thing.name === name && thingName) {
                    thing.fullName = thingName
                }
                return [thing, user.admin]
            }
        })
    }
    async createThing(name: string, description?) {
        const t = new Thing(this, this.nextId++, name, description)

        t.world = this
        if (this.limbo) t.assoc.location = this.limbo
        if (this.thingProto) t.setPrototype(this.thingProto)
        this.thingCache.set(t.id, t)
        this.watcher?.(t)
        await this.doTransaction(async () => {
            return await this.putThing(t)
        })
        return t
    }
    async getThings(ids: thingId[]): Promise<Thing[]> {
        const things = []

        for (const id of ids) {
            things.push(this.getThing(id))
        }
        return things
    }
    getPrototypes() {
        return this.doTransaction(async (things) => {
            const result = new Set()

            await doKeys(things.index(prototypeIndex), key => result.add(key))
            return this.getThings(result as any)
        })
    }
    getInstances(proto: Thing) {
        return this.doTransaction(async (things) => {
            const result = []

            await doAll(things.index(prototypeIndex), async t => result.push(t.id), IDBKeyRange.only(proto.id))
            return await this.getThings(result)
        })
    }
    async toast(toasted: Set<Thing>) {
        return this.doTransaction(async (things) => {
            const protos = new Set(await this.getPrototypes())

            for (const thing of toasted) {
                if (protos.has(thing)) throw new Error(`Attempt to toast prototype ${thing.id}, change references first`)
            }
            for (const thing of toasted) {
                things.delete(thing.id)
                this.thingCache.delete(thing.id)
                thing.toasted = true
                for (const guts of await thing.refs.location) {
                    guts.assoc.location = this.limbo
                }
                for (const associated of await this.getAllAssociated(thing)) {
                    associated.assoc.dissociateFrom(thing)
                }
            }
        })
    }
    stamp(thing: Thing) {
        if (thing) {
            this.transactionThings.add(thing)
        }
        return thing
    }
    stamps(things: Thing[]) {
        for (const t of things) {
            this.stamp(t)
        }
        return things
    }
    async copyThing(thing: Thing, connected = new Set<Thing>()) {
        return this.doTransaction(async () => {
            await this.findConnected(thing, connected)
            const originals = new Map<number, Thing>()
            const copies = new Map<number, Thing>()
            for (const conThing of connected) {
                const cpy = await this.createThing(conThing.name)
                originals.set(conThing._id, conThing)
                copies.set(conThing._id, cpy)
                const id = cpy._id;
                (cpy as any).__proto__ = (conThing as any).__proto__
                cpy._id = id
                this.transactionThings.add(cpy)
            }
            for (const [id, cpy] of copies) {
                const original = originals.get(id)
                for (const prop of Object.keys(original)) {
                    if (prop === '_associations' || prop === '_associationThings') {
                        continue
                    } else if (copies.has(original[prop])) { // probably an id
                        cpy[prop] = copies.get(original[prop])?.id
                    } else if (original[prop] instanceof Set) {
                        cpy[prop] = new Set([...original[prop]].map(t => copies.get(t) || t))
                    } else if (Array.isArray(original[prop])) {
                        cpy[prop] = [...original[prop]].map(t => copies.get(t) || t)
                    } else {
                        cpy[prop] = original[prop]
                    }
                }
                cpy.makeProxies()
                cpy._associations = []
                cpy._associationThings = []
                if (original._associations.length) {
                    for (const [k, v] of original._associations) {
                        cpy._associations.push([k, copies.has(v) ? copies.get(v).id : v])
                    }
                    cpy.assoc.changedAssociations()
                }
                cpy.originalSpec = {} // guarantee this will be written out
            }
            const thingCopy = copies.get(thing.id)
            return thingCopy
        })
    }
    async findConnected(thing: Thing, connected: Set<Thing>) {
        if (!connected.has(thing)) {
            connected.add(thing)
            for (const item of await thing.refs.location) {
                await this.findConnected(item, connected)
            }
            for (const link of await thing.refs.linkOwner) {
                await this.findConnected(link, connected)
            }
        }
        return connected
    }
    async cacheThingFor(thingSpec) {
        if (!thingSpec) return null
        const thing = new Thing(this, null, '')

        thing.world = this
        await thing.useSpec(thingSpec)
        this.thingCache.set(thing.id, thing)
        this.watcher?.(thing)
        return thing
    }
    async cacheThings(specs: any) {
        for (let i = 0; i < specs.length; i++) {
            const thing = this.thingCache.get(specs[i].id)

            specs[i] = thing || await this.cacheThingFor(specs[i])
        }
        return specs
    }
    async getAssociated(prop: string, thing: thingId | Thing): Promise<Thing[]> {
        const id = getId(thing)
        const key = [prop, id]

        return this.stamps(await this.doTransaction(async (things) => {
            if (!things.indexNames.contains(associationIndex)) {
                return []
            }
            return this.cacheThings(await promiseFor(things.index(associationIndex).getAll(IDBKeyRange.only(key))))
        }))
    }
    async getAllAssociated(thing: thingId | Thing): Promise<Thing[]> {
        const id = getId(thing)

        return this.stamps(await this.doTransaction(async (things) => {
            if (!things.indexNames.contains(basicAssociationIndex)) {
                return []
            }
            return this.cacheThings(await promiseFor(things.index(basicAssociationIndex).getAll(IDBKeyRange.only(id))))
        }))
    }
    async getOthers(thing: thingId | Thing): Promise<Thing[]> {
        const id = getId(thing)

        return this.stamps(await this.doTransaction(async (things) => {
            return this.cacheThings(await promiseFor(things.index(otherLinkIndex).getAll(IDBKeyRange.only(id))))
        }))
    }
    async getAncestors(thing: Thing, ancestors = []): Promise<Thing[]> {
        if (thing._prototype) {
            return this.doTransaction(async () => {
                const prototype = await thing.getPrototype()

                await this.getAncestors(prototype, ancestors)
                return ancestors
            })
        } else {
            return ancestors
        }
    }
    async copyWorld(newName: string) {
        if (this.storage.hasWorld(newName)) {
            throw new Error('there is already a world named "' + newName + '"')
        }
        const newWorld = await this.storage.openWorld(newName)
        const txn = this.db().transaction([this.storeName, newWorld.storeName, this.users, newWorld.users], 'readwrite')
        const newThings = txn.objectStore(newWorld.storeName)

        await copyAll(txn.objectStore(this.users), txn.objectStore(newWorld.users))
        await copyAll(txn.objectStore(this.storeName), newThings)
        const newInfo: any = this.spec()
        newInfo.name = newName
        await promiseFor(newThings.put(newInfo))
        this.storage.closeWorld(newName)
    }
    propertyProximity(obj: any, prop: string) {
        let count = 1
        let found = false

        while (obj !== this.thingProto) {
            if (found) {
                count++
            } else if (obj.hasOwnProperty(prop)) {
                found = true
            }
            obj = obj.__proto__
        }
        return found ? count : this.thingProto.hasOwnProperty(prop) ? 0 : -1
    }
}

export class MudStorage {
    db: IDBDatabase
    profile: Profile
    worlds: string[]
    openWorlds: Map<string, World>
    constructor(db) {
        this.db = db
        this.worlds = []
        this.openWorlds = new Map()
    }
    async setPeerID(id: string) {
        if (this.profile.peerID !== id) {
            this.profile.peerID = id
            return this.store()
        }
    }
    async setPeerKey(peerKey: string) {
        if (this.profile.peerKey !== peerKey) {
            this.profile.peerKey = peerKey
            return this.store()
        }
    }
    hasWorld(name: string) {
        return contains([...this.worlds], name)
    }
    closeWorld(name: string) {
        this.openWorlds.delete(name)
    }
    async openWorld(name = '') {
        if (this.openWorlds.has(name)) {
            return this.openWorlds.get(name)
        }
        if (!name) {
            name = this.randomWorldName()
        }
        const world = new World(name, this)
        if (!this.hasWorld(name)) {
            this.worlds.push(name)
            await this.store()
            await world.initDb()
        } else {
            await world.loadInfo()
        }
        await world.initStdPrototypes()
        this.openWorlds.set(name, world)
        return world
    }
    randomWorldName() {
        for (; ;) {
            const name = randomName('mud')

            if (!this.hasWorld(name)) {
                return name;
            }
        }
    }
    store() {
        const txn = this.db.transaction(centralDbName, 'readwrite')
        const store = txn.objectStore(centralDbName)

        return promiseFor(store.put(this.spec(), infoKey))
    }
    spec() {
        return {
            worlds: this.worlds,
            profile: this.profile?.spec(),
        }
    }
    useSpec(spec: any) {
        this.worlds = spec.worlds
        this.profile = new Profile(this, spec.profile)
        return this
    }
    upgrade(then: (arg) => void) {
        let version = this.db.version
        this.db.close()
        const req = indexedDB.open(centralDbName, ++version)

        req.onsuccess = evt => {
            this.db = req.result
            then(evt)
        }
        return req
    }
    async corruptWorld(name: string) {
        try {
            const txn = this.db.transaction([mudDbName(name)], 'readwrite')
            const store = txn.objectStore(mudDbName(name))

            await promiseFor(store.delete('info'))
            return promiseFor(txn)
        } catch (err) { }
    }
    deleteWorld(name: string) {
        return new Promise((succeed, fail) => {
            const index = this.worlds.indexOf(name)

            if (index !== -1) {
                const req = this.upgrade(async () => {
                    await this.store()
                    return succeed()
                })

                req.onupgradeneeded = () => {
                    const txn = req.transaction

                    this.db = req.result
                    this.worlds.splice(index, 1)
                    this.openWorlds.delete(name)
                    txn.db.deleteObjectStore(mudDbName(name))
                    txn.db.deleteObjectStore(userDbName(name))
                    if (txn.db.objectStoreNames.contains(extensionDbName(name))) {
                        txn.db.deleteObjectStore(extensionDbName(name))
                    }
                }
                req.onerror = fail
            } else {
                fail(new Error('There is no world named ' + name))
            }
        })
    }
    renameWorld(name: string, newName: string) {
        return new Promise(async (succeed, fail) => {
            const index = this.worlds.indexOf(name)

            if (newName && name !== newName && index !== -1 && !this.hasWorld(newName)) {
                const world = await this.openWorld(name)
                const req = this.upgrade(async () => {
                    world.setName(newName)
                    await world.doTransaction(() => world.store())
                    console.log('STORING MUD INFO')
                    await this.store()
                    succeed()
                })

                req.onupgradeneeded = async () => {
                    const txn = req.transaction

                    this.db = req.result
                    this.worlds[index] = newName
                    this.openWorlds.set(newName, world)
                    this.openWorlds.delete(name)
                    txn.objectStore(mudDbName(name)).name = mudDbName(newName)
                    txn.objectStore(userDbName(name)).name = userDbName(newName)
                }
                req.onerror = fail
            } else if (name === newName) {
                succeed()
            } else if (index === -1) {
                fail(new Error('There is no world named ' + name))
            } else {
                fail(new Error('There is already a world named ' + newName))
            }
        })
    }
    async strippedBlobForWorld(name: string) {
        const index = this.worlds.indexOf(name)

        if (index === -1) {
            return Promise.reject(new Error('No world found named ' + name))
        }
        return new Promise(async (succeed, fail) => {
            const dbs = [mudDbName(name)]
            if (this.db.objectStoreNames.contains(extensionDbName(name))) {
                dbs.push(extensionDbName(name))
            }
            const txn = this.db.transaction(dbs)
            const result: any = {
                objects: await jsonObjectsForDb(txn.objectStore(mudDbName(name))),
            }

            if (dbs.length === 2) {
                result.extensions = await jsonObjectsForDb(txn.objectStore(extensionDbName(name)))
            }
            succeed(blobForYamlObject(result))
        })
    }
    fullBlobForWorld(name: string): Promise<Blob> {
        const index = this.worlds.indexOf(name)

        if (index === -1) {
            return Promise.reject(new Error('No world found named ' + name))
        }
        return new Promise(async (succeed, fail) => {
            const dbs = [mudDbName(name), userDbName(name)]
            if (this.db.objectStoreNames.contains(extensionDbName(name))) {
                dbs.push(extensionDbName(name))
            }
            const txn = this.db.transaction(dbs)
            const result: any = {
                users: await jsonObjectsForDb(txn.objectStore(userDbName(name))),
                objects: await jsonObjectsForDb(txn.objectStore(mudDbName(name))),
            }

            if (dbs.length === 3) {
                result.extensions = await jsonObjectsForDb(txn.objectStore(extensionDbName(name)))
            }
            succeed(blobForYamlObject(result))
        })
    }
    async uploadWorld(world, failSilently = false) {
        const w = await (world.users ? this.uploadFullWorld(world, failSilently)
            : this.uploadStrippedWorld(world, failSilently))

        if (w) this.closeWorld(w)
        return w
    }
    async uploadFullWorld(worldAndUsers, failSilently: boolean) {
        const users = worldAndUsers.users
        const objects = worldAndUsers.objects
        const info = objects.find(i => i.id === 'info')
        if (this.hasWorld(info.name)) {
            if (failSilently) return info.name
            alert(`There is already a world named ${info.name}, you must rename it or delete it to upload this`)
            return null
        }
        const world = await this.openWorld(info.name)

        await world.doTransaction(async (thingStore, userStore, txn) => {
            return world.replaceUsers(users)
        })
        return this.uploadStrippedWorld(worldAndUsers, failSilently, world)
    }
    async uploadStrippedWorld(data: any, failSilently: boolean, world = null) {
        if (data.extensions) await world.replaceExtensions(data.extensions)
        return world.doTransaction(async (thingStore, userStore, txn) => {
            if (!world) {
                const info = data.objects.find(i => i.id === 'info')

                if (this.hasWorld(info.name)) {
                    if (failSilently) return info.name
                    alert(`There is already a world named ${info.name}, you must rename it or delete it to upload this`)
                    return null
                }
                world = await this.openWorld(info.name)
            }
            await world.replaceThings(data.objects)
            return world.name
        })
    }
}

export class Profile {
    name: string
    peerID: string
    peerKey: string
    port: number
    storage: MudStorage

    constructor(str: MudStorage, spec: any) {
        this.storage = str
        if (spec) {
            Object.assign(this, spec)
        }
    }
    store() {
        return this.storage.store()
    }
    spec() {
        return {
            name: this.name,
            peerID: this.peerID,
            peerKey: this.peerKey,
            port: this.port,
        }
    }
}

function getId(tip: thingId | Thing) {
    if (typeof tip === 'number') {
        if (isNaN(tip)) return null
        return tip
    } else if (tip instanceof Thing) {
        return tip.id
    } else {
        return null
    }
}

async function getTipId(tip: thingId | Thing | Promise<Thing>) {
    if (typeof tip === 'number') {
        if (isNaN(tip)) return null
        return tip
    } else if (tip instanceof Thing) {
        return tip.id
    } else if (tip instanceof Promise) {
        return (await tip).id
    } else {
        return null
    }
}

export function blobForYamlObject(object) {
    return new Blob([jsyaml.dump(object, { flowLevel: 3 })], { type: 'text/yaml' })
}
export function blobForJsonObjects(objects) {
    return new Blob(objects, { type: 'application/json' })
}

export async function blobForDb(objectStore) {
    return blobForJsonObjects(await jsonObjectsForDb(objectStore))
}

export function jsonObjectsForDb(objectStore, records = []) {
    return new Promise((succeed, fail) => {
        const req = objectStore.openCursor()
        const first = true

        req.onsuccess = evt => {
            const cursor = evt.target.result

            if (cursor) {
                records.push(cursor.value)
                cursor.continue()
            } else {
                succeed(records)
            }
        }
        req.onerror = evt => {
            console.log('failure: ', evt)
            fail(evt)
        }
    })
}

function idFor(t: Thing | thingId) {
    if (typeof t === 'number') return t
    if (t === null || t === undefined) return null
    if (t instanceof Thing) return t._id
    throw new Error(`${t} is not a thing or id`)
}
export function identity(x) {
    return x
}
export function sanitizeName(name: string) {
    return name.replace(/ /, '_')
}
export async function getStorage() {
    return storage || await openStorage()
}
export function openStorage() {
    return new Promise((succeed, fail) => {
        console.log('opening storage')
        const req = indexedDB.open(centralDbName)

        req.onupgradeneeded = () => {
            const db = req.result
            const txn = req.transaction

            storage = new MudStorage(db)
            const objectStore = db.createObjectStore(centralDbName)
            const store = txn.objectStore(centralDbName)

            store.put(storage.spec(), infoKey)
        }
        req.onsuccess = async evt => {
            const db = req.result
            const txn = db.transaction(centralDbName, 'readwrite')
            const store = txn.objectStore(centralDbName)

            if (!storage) {
                storage = new MudStorage(db)
            }
            const result = await promiseFor(store.get(infoKey))
            console.log('got storage spec', result)
            succeed(storage.useSpec(result))
        }
    })
}

export function promiseFor(req: IDBRequest | IDBTransaction) {
    if (req instanceof IDBRequest) {
        return new Promise((succeed, fail) => {
            req.onerror = fail
            req.onsuccess = () => succeed(req.result)
        })
    } else {
        return new Promise((succeed, fail) => {
            req.onerror = fail
            req.oncomplete = () => succeed()
        })
    }
}

export function rawPromiseFor(req: IDBRequest | IDBTransaction): Promise<any> {
    if (req instanceof IDBRequest) {
        return new Promise((succeed, fail) => {
            req.onerror = fail
            req.onsuccess = succeed
        })
    } else {
        return new Promise((succeed, fail) => {
            req.onerror = fail
            req.oncomplete = succeed
        })
    }
}

export function contains(array: any[], item: any) {
    return array.indexOf(item) !== -1
}

function mudDbName(name: string) {
    return 'world ' + name
}

function userDbName(name: string) {
    return 'world ' + name + usersSuffix
}

function extensionDbName(name: string) {
    return 'world ' + name + extensionsSuffix
}

function same(a: any, b: any) {
    if (typeof a !== typeof b) return false
    if (a === null || b === null) return a === b
    if (typeof a !== 'object') return a === b
    if (Array.isArray(a) !== Array.isArray(b)) return false
    if (Array.isArray(a)) {
        if (a.length !== b.length) return false
        for (let i = 0; i < a.length; i++) {
            if (!same(a[i], b[i])) return false
        }
        return true
    } else {
        const ak = Object.keys(a)
        const bkset = new Set(Object.keys(b))

        if (a.__proto__ !== b.__proto__) return false
        if (ak.length !== Object.keys(b).length) return false
        for (const k of ak) {
            if (!same(a[k], b[k])) return false
            bkset.delete(k)
        }
        return bkset.size === 0
    }
}

export function randomName(prefix: string) {
    return prefix + Math.round(Math.random() * 10000000)
}

function doKeys(store: IDBObjectStore | IDBIndex, consumer: (arg: any) => void) {
    return new Promise((succeed, fail) => {
        const req = store.openKeyCursor()

        req.onerror = fail
        req.onsuccess = evt => {
            const cursor = (evt.target as any).result

            if (cursor) {
                consumer(cursor.key)
                cursor.continue()
            } else {
                succeed(null)
            }
        }
    })
}

function doAll(store: IDBObjectStore | IDBIndex, consumer: (arg: any, cursor: IDBCursorWithValue) => Promise<any>, range?: IDBKeyRange) {
    return new Promise((succeed, fail) => {
        const req = store.openCursor(range)
        const promises: Promise<any>[] = []

        req.onerror = fail
        req.onsuccess = async evt => {
            const cursor = (evt.target as any).result

            if (cursor) {
                promises.push(consumer(cursor.value, cursor))
                cursor.continue()
            } else {
                return Promise.all(promises).then(succeed)
            }
        }
    })
}

function checkIndex(store: IDBObjectStore, index: string, keypath: any, opts?: any) {
    if (!store.indexNames.contains(index)) {
        store.createIndex(index, keypath, opts)
    }
}

function deleteAll(store: IDBObjectStore) {
    return new Promise((succeed, fail) => {
        const req = store.openCursor()

        req.onerror = fail
        req.onsuccess = evt => {
            const cursor = (evt.target as any).result

            if (cursor) {
                cursor.delete()
                cursor.continue()
            } else {
                succeed(null)
            }
        }
    })
}

async function copyAll(srcStore, dstStore: IDBObjectStore) {
    await deleteAll(dstStore)
    return new Promise((succeed, fail) => {
        const req = srcStore.openCursor()

        req.onerror = fail
        req.onsuccess = async evt => {
            const cursor = (evt.target as any).result

            if (cursor) {
                await dstStore.put(cursor.value)
                cursor.continue()
            } else {
                succeed(null)
            }
        }
    })
}

export function findSimpleName(str: string) {
    let words: string[]
    let article: string
    let tmp: string

    str = str.replace(/[^a-zA-Z0-9_\s]/, '') // scrape out noise characters
    tmp = str.toLowerCase()
    const articleMatch = tmp.match(/^\s*\b(the|a|an)\b/)
    if (articleMatch) {
        article = articleMatch[1]
        tmp = tmp.slice(articleMatch[0].length)
    }
    const prepMatch = tmp.match(/^(.(.*?))\b(of|on|about|in|from|the)\b/)
    if (prepMatch) {
        // if it contains a preposition, discard from the first preposition on
        // the king of sorrows
        // the king in absentia
        // Big Bob of the forest
        // Conan the Barbarian
        str = prepMatch[1]
    }
    words = str.split(/\s+/)
    return [article, article ? words[words.length - 1].toLowerCase() : words[0]]
}

export function escape(text: string) {
    return typeof text === 'string' ? text.replace(/</g, '&lt;') : text
}

export function init() { }

export function toHex(arraylike: any) {
    let result = ''

    for (const i of arraylike) {
        // tslint:disable-next-line:no-bitwise
        const val = (i & 0xFF).toString(16)

        if (val.length === 1) result += '0'
        result += val
    }
    return result
}

export function fromHex(hex: string) {
    const output = new Int8Array(hex.length / 2)

    for (let i = 0; i < hex.length; i += 2) {
        output[i / 2] = Number.parseInt(hex.substring(i, i + 2), 16)
    }
    return output
}

function appendScriptText(text: string, additional: string) {
    const smIndex = text.lastIndexOf('//# sourceMa')

    if (smIndex !== -1) {
        return text.slice(0, smIndex) + '\n;' + additional + ';\n' + text.slice(smIndex)
    }
    return text + '\n;' + additional
}

export function registerExtension(id: number, onStarted: (world: World, con: MudConnection) => void, onLoggedIn: (user: any, thing: Thing) => void) {
    const world = activeWorld
    const ext = world.activeExtensions.get(id)

    onStarted?.(activeWorld, connection)
    ext.onLoggedIn = onLoggedIn
    ext.succeed?.()
}
