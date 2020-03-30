// command protocol
//
// SIGNATURES
//   Sessions: start with a nonce
//   Message sequencing: NONCE.counter
//   Signed JSON: {json: text, signature: sig} -- text is NONCE,JSON
//
import { natTracker, roleTracker, peerTracker, NatState, RoleState, PeerState, } from './base.js';
import proto from './protocol-shim.js';
import { promiseFor, } from './model.js';
import * as gui from './gui.js';
const peerDbName = 'peer';
const textcraftProtocol = 'textcraft';
const callbackProtocol = 'textcraft-callback';
const relayProtocol = 'textcraft-relay';
var app;
var peer;
export function init(appObj) {
    app = appObj;
    console.log('Mudproto', proto);
}
const mudCommands = Object.freeze({
    command: true,
    output: true,
    // to host
    user: true,
    // to peer
    welcome: true,
    updateUser: true,
    addUser: true,
    removeUser: true,
});
// Peer
//
// Connects LoggingHandler -> TrackingHandler -> Peer -> CommandHandler -> strategy
//
// strategy starts out as an empty DeletaingHandler
//  -- peer swaps that depending on how the peer hosts or connects as a guest
//  -- Strategy:
//     HostStrategy:  DirectHostStrategy, IndirectHostStrategy
//     GuestStrategy: DirectGuestStrategy, RelayGuestStrategy, CallbackGuestStrategy
//
// At this point, only one type of connection is supported at a time (host or guest)
//
// Public-natted guests serve as relays for private-natted hosts
//
class Peer extends proto.DelegatingHandler {
    constructor(storage) {
        super(null);
        this.connections = {};
        this.storage = storage;
        if ([...this.db().objectStoreNames].indexOf(peerDbName) == -1) {
            this.createPeerDb();
        }
        this.trackingHandler = new proto.TrackingHandler(this, this.connections);
        this.commandHandler = new MudCommands(null);
        this.delegate = this.commandHandler;
        this.setStrategy(new EmptyStrategy());
    }
    setStrategy(strat) {
        this.strategy = strat;
        this.commandHandler.delegate = strat;
    }
    start() {
        var url = "ws://" + document.location.host + "/";
        console.log("STARTING MUDPROTO");
        proto.startProtocol(url + "libp2p", new proto.LoggingHandler(this.trackingHandler));
    }
    db() {
        return this.storage.db;
    }
    doTransaction(func) {
        if (this.peerDb) {
            return Promise.resolve(func(this.peerDb));
        }
        else {
            return new Promise((succeed, fail) => {
                var txn = this.db().transaction([peerDbName], 'readwrite');
                this.peerDb = txn.objectStore(peerDbName);
                txn.oncomplete = () => {
                    this.peerDb = null;
                    succeed();
                };
                txn.onabort = () => {
                    this.peerDb = null;
                    fail();
                };
                txn.onerror = () => {
                    this.peerDb = null;
                    fail();
                };
            });
        }
    }
    createPeerDb() {
        return new Promise((succeed, fail) => {
            var req = this.storage.upgrade(() => {
                this.doTransaction((peerDb) => {
                    this.store();
                });
            });
            req.onupgradeneeded = () => {
                req.transaction.db.createObjectStore(peerDbName, { keyPath: 'id' });
            };
            req.onerror = fail;
        });
    }
    store() {
        this.peerDb.put({
            id: 'peerInfo',
            peerKey: this.peerKey
        });
    }
    async load() {
        var info = (await promiseFor(this.peerDb.get('peerInfo')));
        this.peerKey = info.peerKey;
    }
    reset() {
        //// TODO
    }
    abortStrategy() {
        this.strategy.aborted();
        this.setStrategy(new EmptyStrategy);
    }
    // P2P API
    hello(started) {
        console.log('RECEIVED HELLO');
        if (started) {
            console.log('Peer already started');
        }
        else {
            console.log('Starting peer...');
            proto.start(this.peerKey || '');
        }
    }
    // P2P API
    async ident(status, peerID, addresses, peerKey) {
        console.log('PEER CONNECTED');
        this.peerKey = peerKey;
        natTracker.setValueNamed(status);
        gui.setPeerId(peerID);
        console.log('IDENT: ', peerID, ' ', status);
        this.peerAddrs = addresses;
        this.reset();
        await this.doTransaction(() => this.store());
        super.ident(status, peerID, addresses, peerKey);
    }
}
class Strategy extends proto.DelegatingHandler {
    constructor(delegate) {
        super(delegate);
    }
    sendObject(conID, obj) {
        proto.sendObject(conID, obj);
    }
}
class EmptyStrategy extends Strategy {
    constructor() {
        super(null);
    }
    aborted() { }
}
class HostStrategy extends Strategy {
    constructor(delegate) {
        super(delegate);
        this.hosting = new Map();
    }
}
class GuestStrategy extends Strategy {
    constructor(delegate, chatHost) {
        super(delegate);
        this.chatHost = chatHost;
    }
    isConnectedToHost() {
        return peerTracker.value == PeerState.connectedToHost;
    }
    connectedToHost(conID, protocol, peerID) {
        roleTracker.setValue(RoleState.Guest);
        gui.connectedToHost(peerID);
        this.sendObject(conID, { name: 'user', peer: peer.peerID });
    }
}
class DirectHostStrategy extends HostStrategy {
    constructor(delegate) {
        super(delegate);
    }
    aborted() {
        ////
    }
    // P2P API
    listening(protocol) {
        if (protocol == textcraftProtocol) {
            this.sessionID = {
                type: 'peerAddr',
                peerID: peer.peerID,
                protocol: textcraftProtocol,
                addrs: peer.peerAddrs
            };
            gui.setConnectString(encodeObject(this.sessionID));
            roleTracker.setValue(RoleState.Host);
            peerTracker.setValue(PeerState.hostingDirectly);
        }
        super.listening(protocol);
    }
    // P2P API
    listenerConnection(conID, peerID, prot) {
        if (prot == textcraftProtocol) {
            var users = [];
            console.log("Got connection " + conID + " for protocol " + prot + " from peer " + peerID);
            this.hosting.set(conID, { conID: conID, peerID, protocol: prot });
        }
        super.listenerConnection(conID, peerID, prot);
    }
}
class IndirectHostStrategy extends HostStrategy {
    constructor(delegate) {
        super(delegate);
    }
    aborted() {
        ////
    }
    abortCallback() {
        proto.stop(callbackProtocol, false);
        proto.close(this.callbackRelayConID);
        this.reset();
    }
    reset() {
        ////
    }
}
class DirectGuestStrategy extends GuestStrategy {
    constructor(delegate, chatHost) {
        super(delegate, chatHost);
    }
    aborted() {
        ////
    }
    // P2P API
    peerConnection(conID, peerID, protocol) {
        super.peerConnection(conID, peerID, protocol);
        switch (peerTracker.value) {
            case PeerState.connectingToHost: // connected directly to host
                if (peerID != this.chatHost) {
                    alert('Connected to unexpected host: ' + peerID);
                }
                else {
                    peerTracker.setValue(PeerState.connectedToHost);
                    this.connectedToHost(conID, protocol, peerID);
                }
                break;
            default:
                break;
        }
    }
}
class RelayGuestStrategy extends GuestStrategy {
    constructor(delegate, chatHost) {
        super(delegate, chatHost);
    }
    aborted() {
        ////
    }
}
class CallbackGuestStrategy extends GuestStrategy {
    constructor(delegate, chatHost) {
        super(delegate, chatHost);
    }
    aborted() {
        ////
    }
    // P2P API
    listenerConnection(conID, peerID, prot) {
        if (prot == callbackProtocol) { // got a callback, verify token later
            if (peerTracker.value != PeerState.awaitingTokenConnection || peerID != this.callbackPeer) {
                proto.connectionError(conID, proto.relayErrors.badCallback, 'Unexpected callback peer', true);
                return;
            }
            else if (this.abort) {
                peer.abortStrategy();
                return;
            }
            peerTracker.setValue(PeerState.awaitingToken);
        }
        super.listenerConnection(conID, peerID, prot);
    }
}
class MudCommands extends proto.CommandHandler {
    constructor(peer) {
        super(null, peer.connections, mudCommands, null, [textcraftProtocol]);
        this.userMap = new Map(); // peerID -> user
        this.reset();
    }
    reset() {
        peerTracker.setValue(PeerState.disconnected);
        this.token = null;
        this.relayConID = null;
        this.userMap = new Map();
        gui.noConnection();
    }
}
function encodePeerId(peerID, addrs) {
    return '/addrs/' + proto.encode_ascii85(JSON.stringify({ peerID, addrs }));
}
function encodeObject(obj) {
    return proto.encode_ascii85(JSON.stringify(obj));
}
function decodeObject(str) {
    try {
        return JSON.parse(proto.decode_ascii85(str));
    }
    catch (err) {
        return null;
    }
}
export function start(storage) {
    peer = new Peer(storage);
    natTracker.setValue(NatState.Unknown);
    peer.start();
}
//# sourceMappingURL=mudproto.js.map