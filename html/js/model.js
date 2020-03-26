var storage;
const centralDbName = 'textcraft';
const infoKey = 'info';
const locationIndex = 'locations';
const linkOwnerIndex = 'linkOwners';
const nameIndex = 'names';
const usersSuffix = ' users';
/*
 * ## The Thing class
 *
 * The World is made of things, and only things. Each room is a thing. Exits between rooms are things. People are things. Items are things. Boxes are things.
 *
 *  My good friend, Fritz Passow, came up with this idea, which he called "Container MUD", where everything is a container.
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
    constructor(id, name, description = '') {
        this._id = id;
        this.name = name;
        this.description = description;
    }
    get id() { return this._id; }
    get name() { return this._name; }
    set name(n) { this.markDirty(this._name = n); }
    get description() { return this._description; }
    set description(d) { this.markDirty(this._description = d); }
    get contents() { return this.world.getContents(this); }
    get location() { return this.world.getThing(this._location); }
    set location(t) { this.markDirty(this._location = t.id); }
    get links() { return this.world.getLinks(this); }
    get linkOwner() { return this.world.getThing(this._linkOwner); }
    set linkOwner(t) { this.markDirty(this._linkOwner = t && t.id); }
    get otherLink() { return this.world.getThing(this._otherLink); }
    set otherLink(t) { this.markDirty(this._otherLink = t && t.id); }
    markDirty(sideEffect) {
        this.world.markDirty(this);
    }
    spec() {
        return {
            id: this._id,
            name: this._name,
            description: this._description,
            location: this._location,
            linkOwner: this._linkOwner,
            otherLink: this._otherLink,
        };
    }
}
export function identity(x) {
    return x;
}
export class World {
    constructor(name, storage) {
        this.name = name;
        this.storeName = mudDbName(name);
        this.storage = storage;
        this.users = userDbName(name);
    }
    initDb() {
        var userStore = this.db().createObjectStore(this.users);
        var thingStore = this.db().createObjectStore(this.storeName, { keyPath: 'id' });
        userStore.createIndex(nameIndex, 'name', { unique: true }); // look up users by name
        thingStore.createIndex(locationIndex, 'location', { unique: false });
        thingStore.createIndex(linkOwnerIndex, 'linkOwner', { unique: false });
        this.doTransaction(() => this.store());
    }
    db() {
        return this.storage.db;
    }
    // perform a transaction, then write all dirty things to storage
    async doTransaction(func) {
        if (this.txn) {
            return this.processTransaction(func);
        }
        else {
            var txn = this.db().transaction([this.storeName, this.users], 'readwrite');
            var oldId = this.nextId;
            this.txn = txn;
            try {
                return this.processTransaction(func);
            }
            finally {
                var store = this.txn.objectStore(this.storeName);
                await Promise.allSettled([...this.dirty].map(dirty => store.put(this.thingCache.get(dirty).spec())))
                    .then(() => {
                    this.txn = null;
                    if (oldId != this.nextId) {
                        return this.store();
                    }
                });
            }
        }
    }
    store() {
        this.txn.objectStore(this.storeName).put(this.spec());
    }
    processTransaction(func) {
        return func(this.txn.objectStore(this.storeName), this.txn.objectStore(this.users), this.txn);
    }
    getThing(id) {
        if (!id) {
            return null;
        }
        else {
            var cached = this.thingCache.get(id);
            if (cached) {
                return cached;
            }
        }
        this.doTransaction(async (store, users, txn) => this.cacheThingFor(await promiseFor(store.get(id))));
    }
    createThing(name, description = '') {
        var t = new Thing(this.nextId++, name, description);
        this.thingCache.set(t.id, t);
        this.doTransaction(async (store, users, txn) => {
            return await promiseFor(store.put(t));
        });
        return t;
    }
    storeThing(thing) {
        this.txn.objectStore(this.storeName).put(thing.spec());
    }
    cacheThingFor(thingSpec) {
        var thing = Object.assign(new Thing(null, null), thingSpec);
        this.thingCache.set(thing.id, thing);
        return thing;
    }
    async getContents(thing) {
        return await promiseFor(this.txn.objectStore(this.storeName).index(locationIndex).getAll(IDBKeyRange.only(thing.id)));
    }
    async getLinks(thing) {
        return await promiseFor(this.txn.objectStore(this.storeName).index(linkOwnerIndex).getAll(IDBKeyRange.only(thing.id)));
    }
    markDirty(thing) {
        this.dirty.add(thing.id);
    }
    spec() {
        return { id: infoKey, nextId: this.nextId };
    }
    async copyWorld(newName) {
        if (this.storage.hasWorld(newName)) {
            throw new Error('there is already a world named "' + newName + '"');
        }
        var newWorld = this.storage.openWorld(newName);
        var txn = this.db().transaction([this.storeName, newWorld.storeName], 'readwrite');
        var srcStore = txn.objectStore(this.storeName);
        var dstStore = txn.objectStore(newWorld.storeName);
        var cursor = (await rawPromiseFor(srcStore.openCursor()).then(e => e.target.result));
        if (cursor) {
            while (cursor.value) {
                await promiseFor(dstStore.put(cursor.value));
                cursor.continue();
            }
        }
    }
}
export function sanitizeName(name) {
    return name.replace(/ /, '_');
}
export function getStorage() {
    return storage || openStorage();
}
async function openStorage() {
    return await promiseFor(indexedDB.open(centralDbName))
        .then((db) => {
        storage = new MudStorage(db);
        if (!contains([...this.db.objectStoreNames], centralDbName)) {
            var objectStore = db.createObjectStore(centralDbName);
            var txn = db.transaction(centralDbName, 'readwrite');
            var store = txn.objectStore(centralDbName);
            store.put(storage.spec(), infoKey);
            return promiseFor(txn).then(() => storage);
        }
        else {
            var txn = db.transaction(centralDbName, 'readwrite');
            var store = txn.objectStore(centralDbName);
            var req = store.get(infoKey);
            return promiseFor(req).then(() => {
                Object.assign(this, req.result);
                return storage;
            });
        }
    });
}
export class MudStorage {
    constructor(db) {
        this.db = db;
    }
    hasWorld(name) {
        return contains([...this.worlds], name);
    }
    openWorld(name) {
        var world = new World(name, this);
        if (!this.hasWorld(name)) {
            world.initDb();
            this.worlds.push(name);
            this.store();
            world.initDb();
        }
        return world;
    }
    deleteWorld(name) {
        var index = this.worlds.indexOf(name);
        if (index != -1) {
            this.worlds.splice(index, 1);
            this.db.deleteObjectStore(mudDbName(name));
            this.db.deleteObjectStore(userDbName(name));
            this.store();
        }
    }
    async store() {
        var txn = this.db.transaction(centralDbName, 'readwrite');
        var store = txn.objectStore(centralDbName);
        await promiseFor(store.put(this.spec(), infoKey));
    }
    spec() {
        return { worlds: this.worlds };
    }
    renameWorld(name, newName) {
        var index = this.worlds.indexOf(name);
        if (name != newName && index != -1 && !this.hasWorld(newName)) {
            var version = this.db.version;
            this.db.close();
            var req = indexedDB.open(centralDbName, ++version);
            req.onupgradeneeded = evt => {
                var txn = req.transaction;
                this.db = req.result;
                this.worlds[index] = newName;
                txn.objectStore(mudDbName(name)).name = mudDbName(newName);
                txn.objectStore(userDbName(name)).name = userDbName(newName);
                this.store();
            };
            req.onsuccess = evt => this.db = req.result;
        }
    }
}
export function promiseFor(req) {
    if (req instanceof IDBRequest) {
        return new Promise((succeed, fail) => {
            req.onerror = fail;
            req.onsuccess = () => succeed(req.result);
        });
    }
    else {
        return new Promise((succeed, fail) => {
            req.onerror = fail;
            req.oncomplete = () => succeed();
        });
    }
}
export function rawPromiseFor(req) {
    if (req instanceof IDBRequest) {
        return new Promise((succeed, fail) => {
            req.onerror = fail;
            req.onsuccess = succeed;
        });
    }
    else {
        return new Promise((succeed, fail) => {
            req.onerror = fail;
            req.oncomplete = succeed;
        });
    }
}
export function contains(array, item) {
    return array.indexOf(item) != -1;
}
function mudDbName(name) {
    return 'world ' + name;
}
function userDbName(name) {
    return 'world ' + name + usersSuffix;
}
//# sourceMappingURL=model.js.map