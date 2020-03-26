var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
const centralDbName = 'textcraft';
const locationIndex = 'locations';
const linkOwnerIndex = 'linkOwners';
const nameIndex = 'names';
const infoKey = 'info';
const usersSuffix = ' users';
var storage;
/*
 * ## The Thing class
 *
 * The World is made of things, and only things. Each room is a thing. Exits between rooms are things. People are things. Items are things. Boxes are things.
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
class Thing {
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
function identity(x) {
    return x;
}
function sanitizeName(name) {
    return name.replace(/ /, '_');
}
class User {
}
class World {
    constructor(name, storage) {
        this.name = name;
        this.storage = storage;
        this.users = name + usersSuffix;
    }
    initDb() {
        var userStore = this.db().createObjectStore(this.users);
        var thingStore = this.db().createObjectStore(this.name, { keyPath: 'id' });
        userStore.createIndex(nameIndex, 'name', { unique: true }); // look up users by name
        thingStore.createIndex(locationIndex, 'location', { unique: false });
        thingStore.createIndex(linkOwnerIndex, 'linkOwner', { unique: false });
    }
    db() {
        return this.storage.db;
    }
    // perform a transaction, then write all dirty things to storage
    doTransaction(func) {
        if (this.txn) {
            return this.processTransaction(func);
        }
        else {
            var txn = this.db().transaction(this.name, this.users);
            var oldId = this.nextId;
            this.txn = txn;
            try {
                return this.processTransaction(func);
            }
            finally {
                var store = this.txn.objectStore(this.name);
                if (oldId != this.nextId) {
                    store.put(this.spec());
                }
                for (var dirty of this.dirty) {
                    store.put(this.thingCache.get(dirty).spec());
                }
                this.txn = null;
            }
        }
    }
    processTransaction(func) {
        return func(this.txn.objectStore(this.name), this.txn.objectStore(this.users), this.txn);
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
        this.doTransaction((store, users, txn) => __awaiter(this, void 0, void 0, function* () { return this.cacheThingFor(yield promiseFor(store.get(id))); }));
    }
    createThing(name, description = '') {
        var t = new Thing(this.nextId++, name, description);
        this.thingCache.set(t.id, t);
        this.doTransaction((store, users, txn) => __awaiter(this, void 0, void 0, function* () {
            return yield promiseFor(store.put(t));
        }));
        return t;
    }
    storeThing(thing) {
        this.txn.objectStore(this.name).put(thing.spec());
    }
    cacheThingFor(thingSpec) {
        var thing = Object.assign(new Thing(null, null), thingSpec);
        this.thingCache.set(thing.id, thing);
        return thing;
    }
    getContents(thing) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield promiseFor(this.txn.objectStore(this.name).index(locationIndex).getAll(IDBKeyRange.only(thing.id)));
        });
    }
    getLinks(thing) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield promiseFor(this.txn.objectStore(this.name).index(linkOwnerIndex).getAll(IDBKeyRange.only(thing.id)));
        });
    }
    markDirty(thing) {
        this.dirty.add(thing.id);
    }
    spec() {
        return { id: infoKey, nextId: this.nextId };
    }
}
function openStorage() {
    return __awaiter(this, void 0, void 0, function* () {
        return yield promiseFor(indexedDB.open(centralDbName))
            .then((db) => {
            storage = new MudStorage(db);
            if (![...this.db.objectStoreNames].find(n => n == centralDbName)) {
                var objectStore = db.createObjectStore(centralDbName);
                var txn = db.transaction(centralDbName);
                var store = txn.objectStore(centralDbName);
                store.put(storage.spec(), infoKey);
                return promiseFor(txn).then(() => storage);
            }
            else {
                var txn = db.transaction(centralDbName);
                var store = txn.objectStore(centralDbName);
                var req = store.get(infoKey);
                return promiseFor(req).then(() => {
                    Object.assign(this, req.result);
                    return storage;
                });
            }
        });
    });
}
class MudStorage {
    constructor(db) {
        this.db = db;
    }
    openWorld(name) {
        var world = new World(name, this);
        if ([...this.db.objectStoreNames].find(nm => nm == name) == null) {
            this.db.createObjectStore(name);
        }
        return world;
    }
    spec() {
        return { worlds: this.worlds };
    }
}
function promiseFor(req) {
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
//# sourceMappingURL=model.js.map