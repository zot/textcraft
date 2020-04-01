export var storage: MudStorage

const jsyaml: any = (window as any).jsyaml
const centralDbName = 'textcraft'
const infoKey = 'info'
const locationIndex = 'locations'
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
    ['_open', 'open'],
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
    _examineFormat: string  // describes an item's contents and links
    _contentsFormat: string // describes an item in contents
    _linkFormat: string     // decribes how this item links to its other link
    _count: number
    _location: thingId      // if this thing has a location, it is in its location's contents
    _linkOwner: thingId     // the owner of this link (if this is a link)
    _otherLink: thingId     // the other link (if this is a link)
    _open: boolean
    world: World
    constructor(id: number, name: string, description = undefined) {
        this._id = id
        this._fullName = name
        this._name = name.split(/ +/)[0]
        if (typeof description != 'undefined') this._description = description
        this._open = true
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
        this.markDirty(this._fullName = n)
        this._name = n.split(/ +/)[0].toLowerCase()
    }
    get description() {return this._description}
    set description(d: string) {this.markDirty(this._description = d)}
    get contentsFormat() {return this._contentsFormat}
    set contentsFormat(f: string) {this.markDirty(this._contentsFormat = f)}
    get examineFormat() {return this._examineFormat}
    set examineFormat(f: string) {this.markDirty(this._examineFormat = f)}
    get linkFormat() {return this._linkFormat}
    set linkFormat(f: string) {this.markDirty(this._linkFormat = f)}
    get open() {return this._open}
    set open(b: boolean) {this.markDirty(this._open = b)}
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
    setLocation(t: Thing) {this.markDirty(this._location = t.id)}
    getLinks(): Promise<Thing[]> {return this.world.getLinks(this)}
    getLinkOwner(): Promise<Thing> {return this.world.getThing(this._linkOwner)}
    setLinkOwner(t: Thing) {this.markDirty(this._linkOwner = t && t.id)}
    getOtherLink(): Promise<Thing> {return this.world.getThing(this._otherLink)}
    setOtherLink(t: Thing) {this.markDirty(this._otherLink = t && t.id)}

    formatName() {
        return (this.article ? this.article + ' ' : '') + this.fullName
    }
    markDirty(sideEffect) {
        this.world.markDirty(this)
    }
    async find(name: string, exclude = new Set()) {
        if (exclude.has(this)) {
            return null
        } else if (this.name.toLowerCase() == name.toLowerCase()) {
            return this
        }
        exclude.add(this)
        for (let item of await this.getContents()) {
            var result = await item.find(name, exclude)

            if (result) {
                return result
            }
        }
        var loc = await this.getLocation()
        if (loc) {
            var result = await loc.find(name, exclude)

            if (result) return result
        }
        var owner = await this.getLinkOwner()
        if (owner) {
            var result = await owner.find(name, exclude)

            if (result) return result
        }
        return null
    }
    store() {
        return this.world.putThing(this)
    }
    spec() {
        var spec = {}

        for (let prop of Object.keys(this)) {
            if (prop[0] == '_') {
                spec[prop.substring(1)] = this[prop]
            }
        }
        return spec
    }
    async useSpec(spec: any) {
        for (let prop of Object.keys(spec)) {
            this['_' + prop] = spec[prop]
        }
        if (spec.prototype) {
            var proto = await this.world.getThing(spec.prototype)

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
        
    constructor(name, storage) {
        this.setName(name)
        this.storage = storage
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
            var req = storage.upgrade(()=> {
                return this.doTransaction(async (store, users, txn)=> {
                    var limbo = await this.createThing('Limbo', 'You are floating in $this<br>$links<br><br>$contents')
                    this.limbo = limbo.id
                    limbo.markDirty(limbo._location = this.limbo)
                    limbo.article = ''
                    var lobby = await this.createThing('Lobby', 'You are in $this')
                    lobby.markDirty(this.lobby = lobby.id)
                    var protos = await this.createThing('Hall of Prototypes')
                    protos.markDirty(this.hallOfPrototypes = protos.id)
                    var thingProto = await this.createThing('thing', 'This is $this')
                    this.thingProto = thingProto
                    thingProto.markDirty(thingProto._location = this.hallOfPrototypes)
                    thingProto.article = 'the'
                    thingProto.contentsFormat = '$This $is here'
                    thingProto.examineFormat = 'Exits: $links<br>Contents: $contents'
                    thingProto.linkFormat = '$This leads to $link'
                    var linkProto = await this.createThing('link', '$This to $link')
                    linkProto.markDirty(linkProto._location = this.hallOfPrototypes)
                    linkProto.article = ''
                    var roomProto = await this.createThing('room', 'You are in $this')
                    roomProto.markDirty(roomProto._location = this.hallOfPrototypes)
                    roomProto.setPrototype(thingProto)
                    limbo.setPrototype(roomProto)
                    lobby.setPrototype(roomProto)
                    protos.setPrototype(roomProto)
                    var personProto = await this.createThing('person', '$This $is only a dude')
                    this.personProto = personProto
                    personProto.markDirty(personProto._location = this.hallOfPrototypes)
                    personProto.setPrototype(thingProto)
                    personProto._article = ''
                    this.store()
                    succeed()
                })
            })

            req.onupgradeneeded = ()=> {
                var txn = req.transaction
                //var userStore = txn.db.createObjectStore(this.users, {autoIncrement: true})
                var userStore = txn.db.createObjectStore(this.users, {keyPath: 'name'})
                var thingStore = txn.db.createObjectStore(this.storeName, {keyPath: 'id'})

                //userStore.createIndex(nameIndex, 'name', {unique: true}) // look up users by name
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
            this.useInfo(await promiseFor(store.get('info')))
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
            var txn = this.db().transaction([this.storeName, this.users], 'readwrite')
            var oldId = this.nextId
    
            this.txn = txn
            this.thingStore = txn.objectStore(this.storeName)
            this.userStore = txn.objectStore(this.users)
            return this.processTransaction(func)
                .finally(async ()=> {
                    await Promise.allSettled([...this.dirty].map(dirty=> this.thingCache.get(dirty).store()))
                    this.dirty = new Set()
                    if (oldId != this.nextId && !allowIdChange) {
                        this.store()
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
        var result = func(this.thingStore, this.userStore, this.txn)

        return result instanceof Promise ? result : Promise.resolve(result)
    }
    getUser(name: string) {
        return this.doTransaction(async (store, users, txn)=> await promiseFor(users.get(name)))
    }
    deleteUser(name: string) {
        return this.doTransaction(async (store, users, txn)=> {
            return new Promise((succeed, fail)=> {
                var req = users.index(nameIndex).openCursor(name)

                req.onsuccess = evt=> {
                    var cursor = (evt.target as any).result

                    if (cursor) {
                        var dreq = cursor.delete()

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
        var userList: any[] = []

        return new Promise((succeed, fail)=> {
            this.doTransaction(async (store, users, txn)=> {
                var req = users.openCursor()
                req.onsuccess = evt=> {
                    var cursor = (evt.target as any).result

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
                let name = randomName('user')

                if (!await this.getUser(name)) {
                    return name;
                }
            }
        })
    }
    async createRandomUser() {
        var name = await this.randomUserName()

        return this.createUser(name, randomName('password'), false)
    }
    createUser(name: string, password: string, admin: boolean) {
        return this.doTransaction(async (store, users, txn)=> {
            let user = {name, password, admin}
            
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
        this.doTransaction(async (store, users, txn)=> Promise.all(newUsers.map(u=> this.putUser(u))))
    }
    async replaceThings(newThings: any[]) {
        var info: any

        await this.doTransaction(async (store, users, txn)=> {
            var index = newThings.findIndex(t=> t.id == 'info')

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
        var id: thingId

        if (typeof tip == 'number') {
            id = tip
        } else if (tip instanceof Thing) {
            return Promise.resolve(tip)
        } else if (tip instanceof Promise) {
            return await tip
        } else {
            return null
        }
        var cached = this.thingCache.get(id)

        if (cached) {
            return Promise.resolve(cached)
        }
        return this.doTransaction(async (store)=> await this.cacheThingFor(await promiseFor(store.get(id))))
    }
    authenticate(name: string, passwd: string) {
        return this.doTransaction(async (store, users, txn)=> {
            var user: any = await promiseFor(users.get(name))

            if (!user || user.password != passwd) {
                throw new Error('Bad user or password')
            }
            if (!user.thing) {
                var thing = await this.createThing(name)

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
    createThing(name: string, description = undefined) {
        var t = new Thing(this.nextId++, name, description)

        t.world = this
        t._location = this.limbo
        if (this.thingProto) t.setPrototype(this.thingProto)
        t._count = 1
        this.thingCache.set(t.id, t)
        this.doTransaction(async ()=> {
            return await this.putThing(t)
        })
        return t
    }
    async cacheThingFor(thingSpec) {
        var thing = new Thing(null, '')

        thing.world = this
        await thing.useSpec(thingSpec)
        this.thingCache.set(thing.id, thing)
        return thing
    }
    async cacheThings(specs: any) {
        for (let i = 0; i < specs.length; i++) {
            var thing = this.thingCache.get(specs[i].id)

            specs[i] = thing || await this.cacheThingFor(specs[i])
        }
        return specs
    }
    getContents(thing: thingId | Thing): Promise<Thing[]> {
        let id = typeof thing == 'number' ? thing : thing.id
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
                var proto = await thing.getPrototype()

                this.getAncestors(proto, ancestors)
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
        var newWorld = await this.storage.openWorld(newName)
        var txn = this.db().transaction([this.storeName, newWorld.storeName, this.users, newWorld.users], 'readwrite')
        var newThings = txn.objectStore(newWorld.storeName)

        await copyAll(txn.objectStore(this.users), txn.objectStore(newWorld.users))
        await copyAll(txn.objectStore(this.storeName), newThings)
        var newInfo: any = await promiseFor(newThings.get('info'))
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
        var world = new World(name, this)
        if (!this.hasWorld(name)) {
            this.worlds.push(name)
            this.store()
            await world.initDb()
        } else {
            await world.loadInfo()
        }
        this.openWorlds.set(name, world)
        return world
    }
    randomWorldName() {
        var name

        for (;;) {
            name = randomName('mud')
            if (!this.hasWorld(name)) {
                return name;
            }
        }
    }
    store() {
        var txn = this.db.transaction(centralDbName, 'readwrite')
        var store = txn.objectStore(centralDbName)

        return promiseFor(store.put(this.spec(), infoKey))
    }
    spec() {
        return {worlds: this.worlds}
    }
    upgrade(then: (arg)=>void) {
        var version = this.db.version
        this.db.close()
        var req = indexedDB.open(centralDbName, ++version)

        req.onsuccess = evt=> {
            this.db = req.result
            then(evt)
        }
        return req
    }
    deleteWorld(name: string) {
        return new Promise((succeed, fail)=> {
            var index = this.worlds.indexOf(name)

            if (index != -1) {
                var req = this.upgrade(async ()=> {
                    await this.store()
                    return succeed()
                })

                req.onupgradeneeded = ()=> {
                    var txn = req.transaction

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
            var index = this.worlds.indexOf(name)

            if (newName && name != newName && index != -1 && !this.hasWorld(newName)) {
                var world = await this.openWorld(name)
                var req = this.upgrade(async ()=> {
                    world.setName(newName)
                    await world.doTransaction(()=> world.store())
                    console.log('STORING MUD INFO')
                    this.store()
                    succeed()
                })

                req.onupgradeneeded = async ()=> {
                    var txn = req.transaction

                    this.db = req.result
                    this.worlds[index] = newName
                    this.openWorlds.set(newName, world)
                    this.openWorlds.delete(name)
                    txn.objectStore(mudDbName(name)).name = mudDbName(newName)
                    txn.objectStore(userDbName(name)).name = userDbName(newName)
                }
                req.onerror = fail
            } else if (name == newName) {
                succeed()
            } else if (index == -1) {
                fail(new Error('There is no world named '+name))
            } else {
                fail(new Error('There is already a world named '+newName))
            }
        })
    }
    async strippedBlobForWorld(name: string) {
        var index = this.worlds.indexOf(name)

        if (index == -1) {
            return Promise.reject(new Error('No world found named '+name))
        }
        return new Promise(async (succeed, fail)=> {
            var txn = this.db.transaction([mudDbName(name)])

            return blobForDb(await txn.objectStore(mudDbName(name)))
        })
    }
    fullBlobForWorld(name: string): Promise<Blob> {
        var index = this.worlds.indexOf(name)

        if (index == -1) {
            return Promise.reject(new Error('No world found named '+name))
        }
        return new Promise(async (succeed, fail)=> {
            var txn = this.db.transaction([mudDbName(name), userDbName(name)])
            var result = {
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
        var users = worldAndUsers.users
        var objects = worldAndUsers.objects
        var info = objects.find(i=> i.id == 'info')

        var world = await this.openWorld(info.name)
        world.doTransaction(async (thingStore, userStore, txn)=> {
            await this.uploadStrippedWorld(objects, world)
            await world.replaceUsers(users)
        })
    }
    async uploadStrippedWorld(objects, world = null) {
        if (world) {
            return world.replaceThings(objects)
        } else {
            var info = objects.find(i=> i.id == 'info')

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
        var req = objectStore.openCursor()
        var first = true

        req.onsuccess = evt=> {
            let cursor = evt.target.result

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
        var req = indexedDB.open(centralDbName)
        
        req.onupgradeneeded = ()=> {
            var db = req.result
            var txn = req.transaction

            storage = new MudStorage(db)
            var objectStore = db.createObjectStore(centralDbName)
            var store = txn.objectStore(centralDbName)
            
            store.put(storage.spec(), infoKey)
        }
        req.onsuccess = async evt=> {
            var db = req.result
            var txn = db.transaction(centralDbName, 'readwrite')
            var store = txn.objectStore(centralDbName)

            if (!storage) {
                storage = new MudStorage(db)
            }
            var result = await promiseFor(store.get(infoKey))
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
    return array.indexOf(item) != -1
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
        let req = store.openCursor()

        req.onerror = fail
        req.onsuccess = evt=> {
            let cursor = (evt.target as any).result

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
        let req = srcStore.openCursor()

        req.onerror = fail
        req.onsuccess = async evt=> {
            let cursor = (evt.target as any).result

            if (cursor) {
                await dstStore.put(cursor.value)
                cursor.continue()
            } else {
                succeed(null)
            }
        }
    })
}

export function init(app: any) {}
