export let storage: MudStorage

const jsyaml: any = (window as any).jsyaml
const centralDbName = 'textcraft'
const infoKey = 'info'
const locationIndex = 'locations'
const userThingIndex = 'things'
const linkOwnerIndex = 'linkOwners'
const nameIndex = 'names'
const usersSuffix = ' users'

export type thingId = number

const spec2ThingProps = new Map([
    ['id', '_id'],
    ['prototype', '_prototype'],
    ['article', '_article'],
    ['name', '_name'],
    ['fullName', '_fullName'],
    ['description', '_description'],
    ['count', '_count'],
    ['location', '_location'],
    ['linkOwner', '_linkOwner'],
    ['otherLink', '_otherLink'],
    ['open', '_open'],
])

const thing2SpecProps = new Map([
    ['_id', 'id'],
    ['_prototype', 'prototype'],
    ['_article', 'article'],
    ['_name', 'name'],
    ['_fullName', 'fullName'],
    ['_description', 'description'],
    ['_count', 'count'],
    ['_location', 'location'],
    ['_linkOwner', 'linkOwner'],
    ['_otherLink', 'otherLink'],
])

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
    _examineFormat: string      // describes an item's contents and links
    _contentsFormat: string     // describes an item in contents
    _linkFormat: string         // decribes how this item links to its other link
    _linkMoveFormat: string     // shown to someone when they move through a link
    _linkEnterFormat: string    // shown to occupants when someone enters through the link
    _linkExitFormat: string     // shown to occupants when someone leaves through the link
    _count: number
    _location: thingId          // if this thing has a location, it is in its location's contents
    _linkOwner: thingId         // the owner of this link (if this is a link)
    _otherLink: thingId         // the other link (if this is a link)
    _keys: thingId[]
    _locked: boolean
    _lockPassFormat: string
    _lockFailFormat: string
    _closed: boolean            // closed objects do not propagate descriptons to their locations
    _vendor: boolean            // produces a copy of things in its contents
    world: World

    constructor(id: number, name: string, description?) {
        this._id = id
        this.fullName = name
        if (typeof description !== 'undefined') this._description = description
        this._location = null
        this._linkOwner = null
        this._otherLink = null
    }
    get id() {return this._id}
    get article() {return this._article}
    set article(a: string) {this._article = a}
    get count() {return this._count}
    set count(n: number) {this._count = n}
    get name() {return this._name}
    set name(n: string) {this.markDirty(this._name = n)}
    get fullName() {return this._fullName}
    set fullName(n: string) {
        n = n.trim()
        const [article, name] = findSimpleName(n)

        this.markDirty(null)
        if (article && n.substring(0, article.length) === article) {
            n = n.substring(article.length).trim()
        }
        if (article) this._article = article
        this._name = escape(name)
        this._fullName = escape(n)
    }
    get description() {return this._description}
    set description(d: string) {this.markDirty(this._description = d)}
    get contentsFormat() {return this._contentsFormat}
    set contentsFormat(f: string) {this.markDirty(this._contentsFormat = f)}
    get examineFormat() {return this._examineFormat}
    set examineFormat(f: string) {this.markDirty(this._examineFormat = f)}
    get linkFormat() {return this._linkFormat}
    set linkFormat(f: string) {this.markDirty(this._linkFormat = f)}
    getContents(): Promise<Thing[]> {return this.world.getContents(this)}
    getPrototype(): Promise<Thing> {return this.world.getThing(this._prototype)}
    setPrototype(t: Thing) {
        this.markDirty(null)
        if (t) {
            this._prototype = t.id as thingId
            (this as any).__proto__ = t
        } else {
            this._prototype = null
        }
    }
    getLocation(): Promise<Thing> {return this.world.getThing(this._location)}
    setLocation(t: Thing | thingId) {this.markDirty(this._location = idFor(t))}
    getLinks(): Promise<Thing[]> {return this.world.getLinks(this)}
    getLinkOwner(): Promise<Thing> {return this.world.getThing(this._linkOwner)}
    setLinkOwner(t: Thing) {this.markDirty(this._linkOwner = t && t.id)}
    getOtherLink(): Promise<Thing> {return this.world.getThing(this._otherLink)}
    setOtherLink(t: Thing) {this.markDirty(this._otherLink = t && t.id)}

    formatName() {
        return (this.article ? this.article + ' ' : '') + this.fullName
    }
    markDirty(sideEffect?) {
        this.world?.markDirty(this)
    }
    async find(name: string, exclude = new Set([])) {
        if (exclude.has(this)) {
            return null
        } else if (this.name.toLowerCase() === name.toLowerCase()) {
            return this
        }
        exclude.add(this)
        for (const item of await this.getContents()) {
            const result = await item.find(name, exclude)

            if (result) {
                return result
            }
        }
        const loc = await this.getLocation()
        if (loc) {
            const result = await loc.find(name, exclude)

            if (result) return result
        }
        const owner = await this.getLinkOwner()
        if (owner) {
            const result = await owner.find(name, exclude)

            if (result) return result
        }
        return null
    }
    store() {
        return this.world.putThing(this)
    }
    spec() {
        const spec = {}

        for (const prop of Object.keys(this)) {
            if (prop[0] === '_') {
                spec[prop.substring(1)] = this[prop]
            }
        }
        return spec
    }
    async useSpec(spec: any) {
        for (const prop of Object.keys(spec)) {
            this['_' + prop] = spec[prop]
        }
        if (spec.prototype) {
            const proto = await this.world.getThing(spec.prototype)

            if (!proto) {
                throw new Error('Could not find prototype '+spec.prototype)
            }
            (this as any).__proto__ = proto
        }
    }
}
export class World {
    name: string
    storeName: string
    lobby: thingId
    limbo: thingId
    hallOfPrototypes: thingId
    thingProto: Thing   // used by createThing()
    personProto: Thing  // used by authenticate()
    users: string
    nextId: number
    storage: Storage
    thingCache: Map<thingId, Thing>
    txn: IDBTransaction
    thingStore: IDBObjectStore
    userStore: IDBObjectStore
    dirty: Set<thingId>

    constructor(name, stg) {
        this.setName(name)
        this.storage = stg
        this.dirty = new Set()
        this.thingCache = new Map()
        this.nextId = 0
    }
    setName(name: string) {
        this.name = name
        this.storeName = mudDbName(name)
        this.users = userDbName(name)
    }
    initDb() {
        return new Promise((succeed, fail)=> {
            const req = storage.upgrade(()=> {
                return this.doTransaction(async (store, users, txn)=> {
                    const limbo = await this.createThing('Limbo', 'You are floating in $this<br>$links<br><br>$contents')
                    this.limbo = limbo.id
                    limbo.markDirty(limbo._location = this.limbo)
                    limbo.article = ''
                    const lobby = await this.createThing('Lobby', 'You are in $this')
                    lobby.markDirty(this.lobby = lobby.id)
                    const protos = await this.createThing('Hall of Prototypes')
                    protos.markDirty(this.hallOfPrototypes = protos.id)
                    const thingProto = await this.createThing('thing', 'This is $this')
                    this.thingProto = thingProto
                    thingProto.markDirty(thingProto._location = this.hallOfPrototypes)
                    thingProto.article = 'the'
                    thingProto.contentsFormat = '$This $is here'
                    thingProto.examineFormat = 'Exits: $links<br>Contents: $contents'
                    thingProto.linkFormat = '$This leads to $link'
                    thingProto._keys = []
                    thingProto._vendor = false
                    thingProto._locked = false
                    const linkProto = await this.createThing('link', '$This to $link')
                    linkProto.markDirty(linkProto._location = this.hallOfPrototypes)
                    linkProto.article = '';
                    (linkProto as any)._cmd = 'go $0'
                    linkProto._linkEnterFormat = '$Arg1 enters $arg2'
                    linkProto._linkMoveFormat = 'You went $name to $arg3'
                    linkProto._linkExitFormat = '$Arg1 went $name to $arg2'
                    linkProto._lockPassFormat = '$forme You open $this and go through to $arg2 $forothers $Arg open$s $this and go$s through to $arg2'
                    linkProto._lockFailFormat = 'You cannot go $this because it is locked'
                    const roomProto = await this.createThing('room', 'You are in $this')
                    roomProto.markDirty(roomProto._location = this.hallOfPrototypes)
                    roomProto._closed = true
                    roomProto.setPrototype(thingProto)
                    limbo.setPrototype(roomProto)
                    lobby.setPrototype(roomProto)
                    protos.setPrototype(roomProto)
                    const personProto = await this.createThing('person', '$This $is only a dude')
                    this.personProto = personProto
                    personProto.markDirty(personProto._location = this.hallOfPrototypes)
                    personProto.setPrototype(thingProto)
                    personProto._article = ''
                    await this.store()
                    succeed()
                })
            })

            req.onupgradeneeded = ()=> {
                const txn = req.transaction
                //let userStore = txn.db.createObjectStore(this.users, {autoIncrement: true})
                const userStore = txn.db.createObjectStore(this.users, {keyPath: 'name'})
                const thingStore = txn.db.createObjectStore(this.storeName, {keyPath: 'id'})

                userStore.createIndex(userThingIndex, 'thing', {unique: true})
                thingStore.createIndex(locationIndex, 'location', {unique: false})
                thingStore.createIndex(linkOwnerIndex, 'linkOwner', {unique: false})
            }
            req.onerror = fail
        })
    }
    loadInfo() {
        return this.doTransaction(async (store, users, txn)=> {
            this.thingStore = store
            this.userStore = users
            return this.useInfo(await promiseFor(store.get('info')))
        }, true)
    }
    async useInfo(info) {
        this.nextId = info.nextId
        this.name = info.name
        this.lobby = info.lobby
        this.limbo = info.limbo
        this.hallOfPrototypes = info.hallOfPrototypes
        this.thingProto = await this.getThing(info.thingProto)
        this.personProto = await this.getThing(info.personProto)
    }
    spec() {
        return {
            id: infoKey,
            nextId: this.nextId,
            name: this.name,
            lobby: this.lobby,
            limbo: this.limbo,
            hallOfPrototypes: this.hallOfPrototypes,
            thingProto: this.thingProto.id,
            personProto: this.personProto.id,
        }
    }
    rename(newName) {
        this.storage.renameWorld(this.name, newName)
    }
    delete() {
        this.storage.deleteWorld(this.name)
    }
    db() {
        return this.storage.db
    }
    // perform a transaction, then write all dirty things to storage
    async doTransaction(func: (store: IDBObjectStore, users: IDBObjectStore, txn: IDBTransaction)=> Promise<any>, allowIdChange = false) {
        if (this.txn) {
            return this.processTransaction(func)
        } else {
            const txn = this.db().transaction([this.storeName, this.users], 'readwrite')
            const oldId = this.nextId

            this.txn = txn
            this.thingStore = txn.objectStore(this.storeName)
            this.userStore = txn.objectStore(this.users)
            return this.processTransaction(func)
                .finally(async ()=> {
                    await Promise.allSettled([...this.dirty].map(dirty=> this.thingCache.get(dirty).store()))
                    this.dirty = new Set()
                    if (oldId !== this.nextId && !allowIdChange) {
                        await this.store()
                    }
                    this.txn = null
                    this.thingStore = this.userStore = null
                })
        }
    }
    store() {
        return promiseFor(this.thingStore.put(this.spec()))
    }
    processTransaction(func: (store: IDBObjectStore, users: IDBObjectStore, txn: IDBTransaction)=> Promise<any>) {
        const result = func(this.thingStore, this.userStore, this.txn)

        return result instanceof Promise ? result : Promise.resolve(result)
    }
    getUser(name: string) {
        return this.doTransaction(async (store, users, txn)=> await promiseFor(users.get(name)))
    }
    getUserForThing(ti: thingId | Thing) {
        return this.doTransaction(async (store, users, txn)=> {
            return promiseFor(users.index(userThingIndex).get(idFor(ti)))
        })
    }
    deleteUser(name: string) {
        return this.doTransaction(async (store, users, txn)=> {
            return new Promise((succeed, fail)=> {
                const req = users.openCursor(name)

                req.onsuccess = evt=> {
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

        return new Promise((succeed, fail)=> {
            return this.doTransaction(async (store, users, txn)=> {
                const req = users.openCursor()
                req.onsuccess = evt=> {
                    const cursor = (evt.target as any).result

                    if (cursor) {
                        userList.push(cursor.value)
                        console.log('found user', cursor.value)
                        cursor.continue()
                    } else {
                        console.log('no more users')
                        succeed(userList)
                    }
                }
                req.onerror = evt=> {
                    console.log('failure: ', evt)
                    fail(evt)
                }
            })
        })
    }
    randomUserName() {
        return this.doTransaction(async (store, users, txn)=> {
            for (;;) {
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
        return this.doTransaction(async (store, users, txn)=> {
            const user = {name, password, admin}

            await this.putUser(user)
            console.log('created user', user)
            return user
        })
    }
    putUser(user: any) {
        return promiseFor(this.userStore.put(user))
    }
    putThing(thing: Thing) {
        return promiseFor(this.thingStore.put(thing.spec()))
    }
    async replaceUsers(newUsers: any[]) {
        await this.doTransaction(async (store, users, txn)=> deleteAll(users))
        return this.doTransaction(async (store, users, txn)=> Promise.all(newUsers.map(u=> this.putUser(u))))
    }
    async replaceThings(newThings: any[]) {
        let info: any

        await this.doTransaction(async (store, users, txn)=> {
            const index = newThings.findIndex(t=> t.id === 'info')

            info = newThings[index]
            newThings.splice(index, 1)
            return deleteAll(store)
        })
        return this.doTransaction(async (store, users, txn)=> {
            await this.useInfo(info)
            return Promise.all(newThings.map(t=> promiseFor(this.thingStore.put(t))))
        })
    }
    async getThing(tip: thingId | Thing | Promise<Thing>): Promise<Thing> {
        let id: thingId

        if (typeof tip === 'number') {
            id = tip
        } else if (tip instanceof Thing) {
            return Promise.resolve(tip)
        } else if (tip instanceof Promise) {
            return await tip
        } else {
            return null
        }
        const cached = this.thingCache.get(id)

        if (cached) {
            return Promise.resolve(cached)
        }
        return this.doTransaction(async (store)=> await this.cacheThingFor(await promiseFor(store.get(id))))
    }
    authenticate(name: string, passwd: string, noauthentication = false) {
        return this.doTransaction(async (store, users, txn)=> {
            let user: any = await promiseFor(users.get(name))

            if (noauthentication && !user) { // auto-create a user
                user = {name, password: null}
                await promiseFor(users.put(user))
            } else if (!user || user.password !== passwd) {
                throw new Error('Bad user or password')
            }
            if (!user.thing) {
                const thing = await this.createThing(name)

                thing.markDirty(thing._location = this.lobby)
                if (this.personProto) thing.setPrototype(this.personProto)
                thing.article = ''
                user.thing = thing.id
                await this.putUser(user)
                return [thing, user.admin]
            } else {
                return [await this.getThing(user.thing), user.admin]
            }
        })
    }
    async createThing(name: string, description?) {
        const t = new Thing(this.nextId++, name, description)

        t.world = this
        t._location = this.limbo
        if (this.thingProto) t.setPrototype(this.thingProto)
        t._count = 1
        this.thingCache.set(t.id, t)
        await this.doTransaction(async ()=> {
            return await this.putThing(t)
        })
        return t
    }
    async cacheThingFor(thingSpec) {
        const thing = new Thing(null, '')

        thing.world = this
        await thing.useSpec(thingSpec)
        this.thingCache.set(thing.id, thing)
        return thing
    }
    async cacheThings(specs: any) {
        for (let i = 0; i < specs.length; i++) {
            const thing = this.thingCache.get(specs[i].id)

            specs[i] = thing || await this.cacheThingFor(specs[i])
        }
        return specs
    }
    getContents(thing: thingId | Thing): Promise<Thing[]> {
        const id = typeof thing === 'number' ? thing : thing.id
        return this.doTransaction(async (things)=> {
            return this.cacheThings(await promiseFor(things.index(locationIndex).getAll(IDBKeyRange.only(id))))
        })
    }
    getLinks(thing: Thing): Promise<Thing[]> {
        return this.doTransaction(async (things)=> {
            return this.cacheThings(await promiseFor(this.thingStore.index(linkOwnerIndex).getAll(IDBKeyRange.only(thing.id))))
        })
    }
    async getAncestors(thing: Thing, ancestors = []): Promise<Thing[]> {
        if (thing._prototype) {
            return this.doTransaction(async ()=> {
                const proto = await thing.getPrototype()

                await this.getAncestors(proto, ancestors)
                return ancestors
            })
        } else {
            return ancestors
        }
    }
    markDirty(thing: Thing) {
        this.dirty.add(thing.id)
    }
    async copyWorld(newName: string) {
        if (this.storage.hasWorld(newName)) {
            throw new Error('there is already a world named "'+newName+'"')
        }
        const newWorld = await this.storage.openWorld(newName)
        const txn = this.db().transaction([this.storeName, newWorld.storeName, this.users, newWorld.users], 'readwrite')
        const newThings = txn.objectStore(newWorld.storeName)

        await copyAll(txn.objectStore(this.users), txn.objectStore(newWorld.users))
        await copyAll(txn.objectStore(this.storeName), newThings)
        const newInfo: any = await promiseFor(newThings.get('info'))
        newInfo.name = newName
        return promiseFor(newThings.put(newInfo))
    }
}

export class MudStorage {
    db: IDBDatabase
    worlds: string[]
    openWorlds: Map<string, World>
    constructor(db) {
        this.db = db
        this.worlds = []
        this.openWorlds = new Map()
    }
    hasWorld(name: string) {
        return contains([...this.worlds], name)
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
        this.openWorlds.set(name, world)
        return world
    }
    randomWorldName() {
        let name

        for (;;) {
            name = randomName('mud')
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
        return {worlds: this.worlds}
    }
    upgrade(then: (arg)=>void) {
        let version = this.db.version
        this.db.close()
        const req = indexedDB.open(centralDbName, ++version)

        req.onsuccess = evt=> {
            this.db = req.result
            then(evt)
        }
        return req
    }
    deleteWorld(name: string) {
        return new Promise((succeed, fail)=> {
            const index = this.worlds.indexOf(name)

            if (index !== -1) {
                const req = this.upgrade(async ()=> {
                    await this.store()
                    return succeed()
                })

                req.onupgradeneeded = ()=> {
                    const txn = req.transaction

                    this.db = req.result
                    this.worlds.splice(index, 1)
                    this.openWorlds.delete(name)
                    txn.db.deleteObjectStore(mudDbName(name))
                    txn.db.deleteObjectStore(userDbName(name))
                }
                req.onerror = fail
            } else {
                fail(new Error('There is no world named '+name))
            }
        })
    }
    renameWorld(name: string, newName: string) {
        return new Promise(async (succeed, fail)=> {
            const index = this.worlds.indexOf(name)

            if (newName && name !== newName && index !== -1 && !this.hasWorld(newName)) {
                const world = await this.openWorld(name)
                const req = this.upgrade(async ()=> {
                    world.setName(newName)
                    await world.doTransaction(()=> world.store())
                    console.log('STORING MUD INFO')
                    await this.store()
                    succeed()
                })

                req.onupgradeneeded = async ()=> {
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
                fail(new Error('There is no world named '+name))
            } else {
                fail(new Error('There is already a world named '+newName))
            }
        })
    }
    async strippedBlobForWorld(name: string) {
        const index = this.worlds.indexOf(name)

        if (index === -1) {
            return Promise.reject(new Error('No world found named '+name))
        }
        return new Promise(async (succeed, fail)=> {
            const txn = this.db.transaction([mudDbName(name)])

            return blobForDb(await txn.objectStore(mudDbName(name)))
        })
    }
    fullBlobForWorld(name: string): Promise<Blob> {
        const index = this.worlds.indexOf(name)

        if (index === -1) {
            return Promise.reject(new Error('No world found named '+name))
        }
        return new Promise(async (succeed, fail)=> {
            const txn = this.db.transaction([mudDbName(name), userDbName(name)])
            const result = {
                objects: await jsonObjectsForDb(txn.objectStore(mudDbName(name))),
                users: await jsonObjectsForDb(txn.objectStore(userDbName(name)))
            }

            succeed(blobForYamlObject(result))
        })
    }
    uploadWorld(world) {
        return world.users ? this.uploadFullWorld(world)
            : this.uploadStrippedWorld(world)
    }
    async uploadFullWorld(worldAndUsers) {
        const users = worldAndUsers.users
        const objects = worldAndUsers.objects
        const info = objects.find(i=> i.id === 'info')
        const world = await this.openWorld(info.name)

        return world.doTransaction(async (thingStore, userStore, txn)=> {
            await this.uploadStrippedWorld(objects, world)
            await world.replaceUsers(users)
        })
    }
    async uploadStrippedWorld(objects, world = null) {
        if (world) {
            return world.replaceThings(objects)
        } else {
            const info = objects.find(i=> i.id === 'info')

            world = await this.openWorld(info.name)
            await world.replaceThings(objects)
        }
    }
}

export function blobForYamlObject(object) {
    return new Blob([jsyaml.dump(object, {flowLevel: 3})], {type: 'text/yaml'})
}
export function blobForJsonObjects(objects) {
    return new Blob(objects, {type: 'application/json'})
}

export async function blobForDb(objectStore) {
    return blobForJsonObjects(await jsonObjectsForDb(objectStore))
}

export function jsonObjectsForDb(objectStore, records = []) {
    return new Promise((succeed, fail)=> {
        const req = objectStore.openCursor()
        const first = true

        req.onsuccess = evt=> {
            const cursor = evt.target.result

            if (cursor) {
                records.push(cursor.value)
                cursor.continue()
            } else {
                succeed(records)
            }
        }
        req.onerror = evt=> {
            console.log('failure: ', evt)
            fail(evt)
        }
    })
}

function idFor(t: Thing | thingId) {
    return t instanceof Thing ? t._id : t
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
    return new Promise((succeed, fail)=> {
        console.log('opening storage')
        const req = indexedDB.open(centralDbName)

        req.onupgradeneeded = ()=> {
            const db = req.result
            const txn = req.transaction

            storage = new MudStorage(db)
            const objectStore = db.createObjectStore(centralDbName)
            const store = txn.objectStore(centralDbName)

            store.put(storage.spec(), infoKey)
        }
        req.onsuccess = async evt=> {
            const db = req.result
            const txn = db.transaction(centralDbName, 'readwrite')
            const store = txn.objectStore(centralDbName)

            if (!storage) {
                storage = new MudStorage(db)
            }
            const result = await promiseFor(store.get(infoKey))
            console.log('got storage spec', result)
            succeed(Object.assign(storage, result))
        }
    })
}

export function promiseFor(req: IDBRequest | IDBTransaction) {
    if (req instanceof IDBRequest) {
        return new Promise((succeed, fail)=> {
            req.onerror = fail
            req.onsuccess = ()=> succeed(req.result)
        })
    } else {
        return new Promise((succeed, fail)=> {
            req.onerror = fail
            req.oncomplete = ()=> succeed()
        })
    }
}

export function rawPromiseFor(req: IDBRequest | IDBTransaction): Promise<any> {
    if (req instanceof IDBRequest) {
        return new Promise((succeed, fail)=> {
            req.onerror = fail
            req.onsuccess = succeed
        })
    } else {
        return new Promise((succeed, fail)=> {
            req.onerror = fail
            req.oncomplete = succeed
        })
    }
}

export function contains(array: any[], item: any) {
    return array.indexOf(item) !== -1
}

function mudDbName(name: string) {
    return 'world '+name
}

function userDbName(name: string) {
    return 'world '+name+usersSuffix
}

export function randomName(prefix: string) {
    return prefix + Math.round(Math.random() * 10000000)
}

function deleteAll(store: IDBObjectStore) {
    return new Promise((succeed, fail)=> {
        const req = store.openCursor()

        req.onerror = fail
        req.onsuccess = evt=> {
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
    return new Promise((succeed, fail)=> {
        const req = srcStore.openCursor()

        req.onerror = fail
        req.onsuccess = async evt=> {
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
    let name: string
    let article: string
    let foundPrep = false
    let tmp = str

    for (;;) {
        const prepMatch = tmp.match(/^(.*?)\b(of|on|about|in|from)\b/)

        if (prepMatch) {
            if (prepMatch[1].trim()) {
                // if it contains a preposition, discard from the first preposition on
                // the king of sorrows
                // the king in absentia
                words = str.substring(0, tmp.length - prepMatch[1].length).trim().split(/\s+/)
                foundPrep = true
                break
            } else {
                tmp = tmp.substring(prepMatch[1].length)
                continue
            }
        }
        words = str.split(/\s+/)
        break
    }
    if (words.length > 1 && words[0].match(/\b(the|a|an)\b/)) { // scrape articles
        article = words[0]
        words = words.slice(1)
    }
    // choose the last word
    name = words[words.length - 1].toLowerCase()
    return [article, name]
}

export function escape(text: string) {
    return typeof text === 'string' ? text.replace(/</g, '&lt;') : text
}

export function init(app: any) {}
