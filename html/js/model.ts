const centralDbName = 'textcraft'
const locationIndex = 'locations'
const linkOwnerIndex = 'linkOwners'
const nameIndex = 'names'
const infoKey = 'info'
const usersSuffix = ' users'
var storage: MudStorage

type thingId = number

interface PromiseConstructor {
    allSettled(handler)
}

/* Thing is the universal MUD object
 *
 * Each thing has an id, name, and description
 * Things can have a location in another thing
 * Things can have contents (things that are located in them)
 * Things can be linked to other things via things acting as links
 *
 */
class Thing {
    _id: thingId
    _name: string
    _description: string
    _location: thingId    // if this thing has a location, it is in its location's contents
    _linkOwner: thingId   // the owner of this link (if this is a link)
    _otherLink: thingId   // the other link (if this is a link)
    world: World
    constructor(id: number, name: string, description = '') {
        this._id = id
        this.name = name
        this.description = description
    }
    get id() {return this._id}
    get name() {return this._name}
    set name(n: string) {this.markDirty(this._name = n)}
    get description() {return this._description}
    set description(d: string) {this.markDirty(this._description = d)}
    get contents() {return this.world.getContents(this)}
    get location() {return this.world.getThing(this._location)}
    set location(t: Thing) {this.markDirty(this._location = t.id)}
    get links() {return this.world.getLinks(this)}
    get linkOwner() {return this.world.getThing(this._linkOwner)}
    set linkOwner(t: Thing) {this.markDirty(this._linkOwner = t && t.id)}
    get otherLink() {return this.world.getThing(this._otherLink)}
    set otherLink(t: Thing) {this.markDirty(this._otherLink = t && t.id)}
    markDirty(sideEffect) {
        this.world.markDirty(this)
    }
    spec() {
        return {
            id: this._id,
            name: this._name,
            description: this._description,
            location: this._location,
            linkOwner: this._linkOwner,
            otherLink: this._otherLink,
        }
    }
}
function identity(x) {
    return x
}
function sanitizeName(name: string) {
    return name.replace(/ /, '_')
}
class User {
}
class World {
    name: string
    users: string
    nextId: number
    storage: Storage
    thingCache: Map<thingId, Thing>
    dirty: Set<thingId>
    txn: IDBTransaction
    constructor(name, storage) {
        this.name = name
        this.storage = storage
        this.users = name + usersSuffix
    }
    initDb() {
        var userStore = this.db().createObjectStore(this.users)
        var thingStore = this.db().createObjectStore(this.name, {keyPath: 'id'})

        userStore.createIndex(nameIndex, 'name', {unique: true}) // look up users by name
        thingStore.createIndex(locationIndex, 'location', {unique: false})
        thingStore.createIndex(linkOwnerIndex, 'linkOwner', {unique: false})
    }
    db() {
        return this.storage.db
    }
    // perform a transaction, then write all dirty things to storage
    doTransaction(func) {
        if (this.txn) {
            return this.processTransaction(func)
        } else {
            var txn = this.db().transaction(this.name, this.users)
            var oldId = this.nextId
    
            this.txn = txn
            try {
                return this.processTransaction(func)
            } finally {
                var store = this.txn.objectStore(this.name)

                if (oldId != this.nextId) {
                    store.put(this.spec())
                }
                for (var dirty of this.dirty) {
                    store.put(this.thingCache.get(dirty).spec())
                }
                this.txn = null
            }
        }
    }
    processTransaction(func) {
        return func(this.txn.objectStore(this.name), this.txn.objectStore(this.users), this.txn)
    }
    getThing(id: thingId): Thing {
        if (!id) {
            return null
        } else {
            var cached = this.thingCache.get(id)

            if (cached) {
                return cached
            }
        }
        this.doTransaction(async (store, users, txn)=> this.cacheThingFor(await promiseFor(store.get(id))))
    }
    createThing(name: string, description = '') {
        var t = new Thing(this.nextId++, name, description)

        this.thingCache.set(t.id, t)
        this.doTransaction(async (store, users, txn)=> {
            return await promiseFor(store.put(t))
        })
        return t
    }
    storeThing(thing) {
        this.txn.objectStore(this.name).put(thing.spec())
    }
    cacheThingFor(thingSpec) {
        var thing = Object.assign(new Thing(null, null), thingSpec)

        this.thingCache.set(thing.id, thing)
        return thing
    }
    async getContents(thing: Thing) {
        return await promiseFor(this.txn.objectStore(this.name).index(locationIndex).getAll(IDBKeyRange.only(thing.id)))
    }
    async getLinks(thing: Thing) {
        return await promiseFor(this.txn.objectStore(this.name).index(linkOwnerIndex).getAll(IDBKeyRange.only(thing.id)))
    }
    markDirty(thing: Thing) {
        this.dirty.add(thing.id)
    }
    spec() {
        return {id: infoKey, nextId: this.nextId}
    }
}
async function openStorage() {
    return await promiseFor(indexedDB.open(centralDbName))
        .then((db: IDBDatabase)=> {
            storage = new MudStorage(db)
            if (![...this.db.objectStoreNames].find(n=> n == centralDbName)) {
                var objectStore = db.createObjectStore(centralDbName)
                var txn = db.transaction(centralDbName)
                var store = txn.objectStore(centralDbName)
        
                store.put(storage.spec(), infoKey)
                return promiseFor(txn).then(()=> storage)
            } else {
                var txn = db.transaction(centralDbName)
                var store = txn.objectStore(centralDbName)
                var req = store.get(infoKey)

                return promiseFor(req).then(()=> {
                    Object.assign(this, req.result)
                    return storage
                })
            }
        })
}
class MudStorage {
    db: IDBDatabase
    worlds: string[]
    constructor(db) {
        this.db = db
    }
    openWorld(name: string) {
        var world = new World(name, this)

        if ([...this.db.objectStoreNames].find(nm=> nm == name) == null) {
            this.db.createObjectStore(name)
        }
        return world
    }
    spec() {
        return {worlds: this.worlds}
    }
}

function promiseFor(req: IDBRequest | IDBTransaction) {
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
