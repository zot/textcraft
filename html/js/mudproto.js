// command protocol
//
// SIGNATURES
//   Sessions: start with a nonce
//   Message sequencing: NONCE.counter
//   Signed JSON: {json: text, signature: sig} -- text is NONCE,JSON
//
import { natTracker, roleTracker, peerTracker, sectionTracker, mudTracker, relayTracker, NatState, RoleState, PeerState, SectionState, MudState, RelayState, assertUnreachable, } from './base.js';
import proto from './protocol-shim.js';
import * as gui from './gui.js';
import { activeWorld, removeRemotes, myThing, createConnection, } from './mudcontrol.js';
const peerDbName = 'peer';
let app;
export let peer;
export function init(appObj) {
    app = appObj;
    console.log('Mudproto', proto);
}
const mudCommands = Object.freeze({
    // to source
    requestMudConnection: true,
    command: true,
    // to peer
    output: true,
    welcome: true,
    setUser: true,
    removeUser: true,
});
export class UserInfo {
    constructor(peerID, name) {
        this.peerID = peerID;
        this.name = name;
    }
}
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
        peer = this;
        this.connections = {};
        this.userMap = new Map();
        this.storage = storage;
        this.trackingHandler = new proto.TrackingHandler(this, this.connections);
        this.setStrategy(new Strategy());
    }
    get peerID() { return this.storage.profile.peerID; }
    setPeerID(id) {
        return this.storage.setPeerID(id);
    }
    get peerKey() { return this.storage.profile.peerID; }
    setPeerKey(key) {
        return this.storage.setPeerKey(key);
    }
    startHosting() {
        this.reset();
        roleTracker.setValue(RoleState.Host);
        if (natTracker.value === NatState.Public) {
            const strategy = new DirectHostStrategy();
            this.setStrategy(strategy);
            strategy.start();
        }
        sectionTracker.setValue(SectionState.Connection);
    }
    startRelay() {
        this.reset();
        const strategy = new RelayServiceStrategy();
        this.setStrategy(strategy);
        strategy.start();
    }
    hostViaRelay(sessionID) {
        this.reset();
        const strategy = new RelayedHostStrategy();
        this.setStrategy(strategy);
        strategy.useRelay(decodeObject(sessionID));
    }
    relaySessionID() {
        if (this.delegate instanceof RelayServiceStrategy) {
            return this.delegate.relaySessionID;
        }
    }
    joinSession(sessionID) {
        this.reset();
        if (!sessionID) {
            throw new Error('Enter a session ID to join');
        }
        console.log('JOIN', decodeObject(sessionID));
        const strategy = new DirectGuestStrategy(decodeObject(sessionID));
        this.setStrategy(strategy);
        strategy.start();
    }
    setStrategy(strat) {
        this.delegate = this.strategy = strat;
    }
    userThingChanged(thing) {
        const peerID = this.peerIdForThing(thing);
        this.setUser(peerID, new UserInfo(peerID, thing.name));
        if (this.strategy instanceof HostStrategy) {
            this.strategy.userChanged(peerID);
        }
    }
    peerIdForThing(thing) {
        if (myThing() === thing)
            return this.peerID;
        return this.strategy.peerIdForThing(thing);
    }
    setUser(peerID, user) {
        this.userMap.set(peerID, user);
        this.showUsers();
    }
    removeUser(peerID) {
        this.userMap.delete(peerID);
        this.showUsers();
    }
    sendCommand(text) {
        this.strategy.sendCommand(text);
    }
    showUsers() {
        const map = new Map(this.userMap);
        map.delete(this.peerID);
        gui.showUsers(map);
    }
    async start() {
        const url = "ws://" + document.location.host + "/";
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
                const txn = this.db().transaction([peerDbName], 'readwrite');
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
    reset() {
        if (peerTracker.value !== PeerState.disconnected || relayTracker.value > RelayState.Idle) {
            this.strategy.close();
            this.setStrategy(new Strategy());
            peerTracker.setValue(PeerState.disconnected);
            if (natTracker.value === NatState.Public)
                relayTracker.setValue(RelayState.Idle);
            gui.noConnection();
        }
        switch (roleTracker.value) {
            case RoleState.None:
            case RoleState.Guest:
            case RoleState.Relay:
                roleTracker.setValue(RoleState.None);
                mudTracker.setValue(MudState.NotPlaying);
                break;
            case RoleState.Host:
                roleTracker.setValue(RoleState.Solo);
                removeRemotes();
            case RoleState.Solo:
                break;
            default:
                assertUnreachable(roleTracker.value);
                break;
        }
    }
    // P2P API
    hello(started) {
        console.log('RECEIVED HELLO');
        if (started) {
            console.log('Peer already started');
        }
        else {
            console.log('Starting peer...');
            proto.start(this.storage.profile.peerKey || '');
        }
    }
    // P2P API
    async ident(status, peerID, addresses, peerKey) {
        console.log('PEER CONNECTED');
        await this.storage.setPeerID(peerID);
        await this.storage.setPeerKey(peerKey);
        natTracker.setValueNamed(status);
        gui.setPeerId(peerID);
        console.log('IDENT: ', peerID, ' ', status);
        this.peerAddrs = addresses;
        this.reset();
        super.ident(status, peerID, addresses, peerKey);
    }
}
class Strategy extends proto.CommandHandler {
    constructor() {
        super(null, peer.connections, mudCommands, null, []);
    }
    sendObject(conID, obj) {
        proto.sendObject(conID, obj);
    }
    close() { }
    sendCommand(text) {
        throw new Error(`This connection cannot send commands`);
    }
}
class HostStrategy extends Strategy {
    constructor() {
        super();
        this.hosting = new Map();
        this.mudConnections = new Map();
        this.mudProtocol = 'textcraft-' + randomChars();
        this.protocols.add(this.mudProtocol);
        this.sessionID = {
            type: 'peerAddr',
            peerID: peer.peerID,
            protocol: this.mudProtocol,
            addrs: peer.peerAddrs,
        };
        const thing = myThing();
        if (thing) {
            peer.setUser(peer.peerID, new UserInfo(peer.peerID, thing.name));
        }
    }
    close() {
        for (const con of this.mudConnections.values()) {
            // tslint:disable-next-line:no-floating-promises
            con.close();
        }
        this.mudConnections = null;
        this.hosting = null;
        this.sessionID = null;
    }
    peerIdForThing(thing) {
        for (const [pid, con] of this.mudConnections) {
            if (con.thing === thing) {
                return pid;
            }
        }
    }
    userChanged(peerID) {
        const cmd = {
            name: 'setUser',
            peerID,
            user: peer.userMap.get(peerID).name,
        };
        for (const [pid, con] of this.mudConnections) {
            const info = proto.getInfoForPeerAndProtocol(peer.connections, pid, this.mudProtocol);
            if (info !== undefined) {
                this.sendObject(info.conID, cmd);
            }
        }
        return cmd;
    }
    playerLeft(peerID) {
        // tslint:disable-next-line:no-floating-promises
        this.mudConnections.get(peerID).close();
        this.mudConnections.delete(peerID);
    }
    async newPlayer(conID, peerID, protocol) {
        const users = [];
        const mudcon = createConnection(activeWorld, text => this.sendObject(conID, {
            name: 'output',
            hostID: peer.peerID,
            text,
        }), true);
        console.log("Got connection " + conID + " for protocol " + protocol + " from peer " + peerID);
        this.hosting.set(conID, { conID, peerID, protocol });
        for (const [pid, con] of this.mudConnections) {
            users.push({ peerID: pid, user: con.thing.name });
        }
        if (myThing())
            users.push({ peerID: peer.peerID, user: myThing().name });
        this.sendObject(conID, { name: 'welcome', users });
        this.mudConnections.set(peerID, mudcon);
    }
    // mud API message
    async requestMudConnection(info, { user }) {
        const mudcon = this.mudConnections.get(info.peerID);
        await mudcon.doLogin(info.peerID, null, user, true);
        peer.setUser(info.peerID, new UserInfo(info.peerID, mudcon.thing.name));
        this.userChanged(info.peerID);
    }
    // mud API message
    async command(info, { text }) {
        return this.mudConnections.get(info.peerID).command(text);
    }
}
class DirectHostStrategy extends HostStrategy {
    close() {
        if (this.mudConnections) {
            proto.stop(this.mudProtocol, false);
        }
        super.close();
    }
    start() {
        peerTracker.setValue(PeerState.startingHosting);
        proto.listen(this.mudProtocol, true);
    }
    // P2P API
    listening(protocol) {
        if (protocol === this.mudProtocol) {
            gui.setConnectString(encodeObject(this.sessionID));
            console.log('SessionID', decodeObject(encodeObject(this.sessionID)));
            roleTracker.setValue(RoleState.Host);
            peerTracker.setValue(PeerState.hostingDirectly);
        }
        super.listening(protocol);
    }
    // P2P API
    async listenerConnection(conID, peerID, protocol) {
        if (protocol === this.mudProtocol) {
            await this.newPlayer(conID, peerID, protocol);
        }
        super.listenerConnection(conID, peerID, protocol);
    }
    // P2P API
    connectionClosed(conID, msg) {
        const con = this.hosting.get(conID);
        if (con) {
            this.hosting.delete(conID);
            peer.removeUser(con.peerID);
            for (const [id, hcon] of this.hosting) {
                if (id !== conID) {
                    this.sendObject(id, {
                        name: 'removeUser',
                        peerID: con.peerID,
                    });
                }
            }
            peer.showUsers();
        }
        super.connectionClosed(conID, msg);
    }
    // P2P API
    listenerClosed(protocol) {
        if (protocol === this.mudProtocol) {
            peer.reset();
        }
        super.listenerClosed(protocol);
    }
}
// This is for a private host
class RelayedHostStrategy extends HostStrategy {
    //    callbackRelays = new Set<number>()
    //    callbackRelayConID: ConID
    constructor() {
        super();
        this.relayAddrs = [];
        this.nextRelayConnectionId = BigInt(-1);
        peerTracker.setValue(PeerState.connectedToRelayForHosting);
    }
    useRelay(relaySessionID) {
        const { relayID, relayAddrs, relayProtocol } = relaySessionID;
        this.relayID = relayID;
        this.relayAddrs = relayAddrs;
        this.relayProtocol = relayProtocol;
        this.sessionID.relayID = relayID;
        this.sessionID.addrs = relayAddrs;
        peerTracker.setValue(PeerState.connectingToRelayForHosting);
        proto.connect(encodePeerId(relayID, relayAddrs), relayProtocol, true);
    }
    relay() { return this.delegate; }
    userChanged(peerID) {
        const cmd = super.userChanged(peerID);
        this.sendObject(this.relayConID, cmd);
        return cmd;
    }
    // P2P API
    async peerConnection(conID, peerID, protocol) {
        if (peerID !== this.relayID) {
            gui.error(`Connected to unexpected host: ${peerID}, expecting relay peer: ${this.relayID}`);
            return;
        }
        else if (peerTracker.value !== PeerState.connectingToRelayForHosting) {
            gui.error(`Unexpected connction to relay service`);
            return;
        }
        // connected to relay
        proto.sendObject(conID, {
            name: 'requestHosting',
            protocol: this.mudProtocol,
            sessionID: encodeObject(this.sessionID),
        });
        this.relayConID = conID;
        this.delegate = new proto.RelayHost(peer.connections, this, {
            //receiveRelay: this.receiveRelay.bind(this),
            receiveRelayConnectionFromPeer: this.receiveRelayConnectionFromPeer.bind(this),
            receiveRelayCallbackRequest: this.receiveRelayCallbackRequest.bind(this),
            relayConnectionClosed: this.relayConnectionClosed.bind(this),
        }, this.relayProtocol, this.mudProtocol);
        this.commandConnections.add(conID);
        this.relay().addConnection(peerID, protocol, true);
        this.hosting.set(conID, { conID, peerID, protocol });
        gui.setConnectString(encodeObject(this.sessionID));
        peerTracker.setValue(PeerState.connectedToRelayForHosting);
        roleTracker.setValue(RoleState.Host);
        this.commandConnections.add(conID);
        await this.newPlayer(conID, peerID, this.mudProtocol);
        super.peerConnection(conID, peerID, protocol);
    }
    // P2P API
    connectionClosed(conID, msg) {
        if (peerTracker.value === PeerState.connectedToRelayForHosting && conID === this.relayConID) {
            this.relayConID = null;
            peer.reset();
        }
        super.connectionClosed(conID, msg);
    }
    // RELAY API
    receiveRelayConnectionFromPeer(info, { peerID, protocol }) {
        //        const newInfo = new proto.ConnectionInfo(--this.nextRelayConnectionId, peerID, protocol)
        //        let ids = peer.connections.conIDsByPeerID.get(peerID)
        //
        //        if (!ids) {
        //            ids = new Map();
        //            peer.connections.conIDsByPeerID.set(peerID, ids);
        //        }
        //        ids.set(newInfo.conID, protocol);
        //        ids.set(protocol, newInfo.conID);
        //        this.listenerConnection(newInfo.conID, peerID, protocol);
    }
    // RELAY API
    receiveRelayCallbackRequest(info, { peerID, protocol, callbackProtocol, token }) {
        //connect(peerID, protocol, true);
    }
    // RELAY API
    relayConnectionClosed(info, { peerID, protocol }) {
        const newInfo = proto.getInfoForPeerAndProtocol(peer.connections, peerID, protocol);
        newInfo && this.connectionClosed(newInfo.conID);
    }
}
class GuestStrategy extends Strategy {
    constructor(mudHost, hostAddrs, protocol) {
        super();
        this.mudHost = mudHost;
        this.mudProtocol = protocol;
        this.hostAddrs = hostAddrs;
    }
    sendCommand(text) {
        this.sendObject(this.mudConnection, { name: 'command', text });
    }
    close() {
        if (this.mudConnection) {
            proto.close(this.mudConnection);
            this.mudConnection = null;
        }
    }
    isConnectedToHost() {
        return peerTracker.value === PeerState.connectedToHost;
    }
    connectedToHost(conID, protocol, peerID) {
        roleTracker.setValue(RoleState.Guest);
        gui.connectedToHost(peerID);
        this.sendObject(this.mudConnection, { name: 'requestMudConnection', user: peer.storage.profile.name });
    }
    // P2P API
    peerConnection(conID, peerID, protocol) {
        if (protocol === this.mudProtocol) {
            this.mudConnection = conID;
        }
        super.peerConnection(conID, peerID, protocol);
    }
    // P2P API
    peerConnectionRefused(peerID, prot, msg) {
        peer.reset();
        gui.connectionRefused(peerID, prot, msg);
    }
    // P2P API
    connectionClosed(conID, msg) {
        if (this.mudConnection === conID) {
            peer.reset();
        }
        super.connectionClosed(conID, msg);
    }
    // mud API message
    output(info, { text }) {
        gui.addMudOutput(text);
    }
    // mud API message
    welcome(info, { users }) {
        peer.userMap = new Map();
        for (const { peerID, user } of users) {
            peer.userMap.set(peerID, new UserInfo(peerID, user));
        }
        peer.showUsers();
    }
    // mud API message
    setUser(info, { peerID, user }) {
        peer.setUser(peerID, new UserInfo(peerID, user));
        peer.showUsers();
    }
    // mud API message
    removeUser(info, { peerID }) {
        peer.removeUser(peerID);
        peer.showUsers();
    }
}
class DirectGuestStrategy extends GuestStrategy {
    constructor({ peerID, addrs, protocol }) {
        super(peerID, addrs, protocol);
        this.protocols.add(protocol);
    }
    start() {
        peerTracker.setValue(PeerState.connectingToHost);
        proto.connect(encodePeerId(this.mudHost, this.hostAddrs), this.mudProtocol, true);
    }
    // P2P API
    peerConnection(conID, peerID, protocol) {
        super.peerConnection(conID, peerID, protocol);
        switch (peerTracker.value) {
            case PeerState.connectingToHost: // connected directly to host
                if (peerID !== this.mudHost) {
                    alert('Connected to unexpected host: ' + peerID);
                }
                else {
                    peerTracker.setValue(PeerState.connectedToHost);
                    roleTracker.setValue(RoleState.Guest);
                    mudTracker.setValue(MudState.Playing);
                    this.connectedToHost(conID, protocol, peerID);
                }
                break;
            default:
                throw new Error(`Illegal peer state: ${peerTracker.currentStateName()}`);
                break;
        }
    }
}
// This is for a public guest peer relying for a private host
class RelayServiceStrategy extends GuestStrategy {
    constructor() {
        super(null, null, null);
        this.relayProtocol = `textcraft-relay-${randomChars()}`;
        this.delegate = new proto.RelayService(peer.connections, null, {
            requestHosting: this.requestHosting.bind(this),
        }, this.relayProtocol);
        this.relaySessionID = encodeObject({
            type: 'relayAddr',
            relayID: peer.peerID,
            relayProtocol: this.relayProtocol,
            relayAddrs: peer.peerAddrs
        });
    }
    relayService() { return this.delegate; }
    start() {
        this.relayService().startRelay();
        //allow any peer to request hosting for now but only enable for the first connection
        //this.relayService().enableRelay(this.mudHost, this.mudProtocol);
        roleTracker.setValue(RoleState.Relay);
        relayTracker.setValue(RelayState.PendingHosting);
    }
    close() {
        this.relayService()?.stopRelay();
        super.close();
    }
    // RELAY API
    requestHosting(info, { protocol }) {
        if (this.mudHost && info.peerID !== this.mudHost) {
            proto.close(info.conID);
            return;
        }
        //only allow the requesting peer to host from now on
        this.relayService().enableHost(this.mudHost, this.mudProtocol);
        this.commandConnections.add(info.conID);
        this.mudHost = info.peerID;
        this.mudProtocol = protocol;
        this.protocols.add(protocol);
        relayTracker.setValue(RelayState.Hosting);
        peerTracker.setValue(PeerState.connectedToHost);
        roleTracker.setValue(RoleState.Guest);
        mudTracker.setValue(MudState.Playing);
        this.mudConnection = info.conID;
        this.connectedToHost(info.conID, this.mudProtocol, info.peerID);
    }
}
// This is for a private peer connecting to a private host
class RelayedGuestStrategy extends GuestStrategy {
    constructor(mudHost) {
        super(mudHost, null, null);
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
export function randomChars(count = 16) {
    const a = 'a'.charCodeAt(0);
    const A = 'A'.charCodeAt(0);
    let chars = '';
    while (--count) {
        const n = Math.round(Math.random() * 51);
        chars += String.fromCharCode(n < 26 ? a + n : A + n - 26);
    }
    return chars;
}
export async function start(storage) {
    peer = new Peer(storage);
    natTracker.setValue(NatState.Unknown);
    return peer.start();
}
export function startHosting() {
    peer?.startHosting();
}
export function joinSession(sessionID) {
    peer?.reset();
    peer?.joinSession(sessionID);
}
export function reset() {
    peer?.reset();
}
export function connectString() {
    return peer?.strategy instanceof HostStrategy && encodeObject(peer.strategy.sessionID);
}
export function relayConnectString() {
    return peer?.relaySessionID();
}
export function command(text) {
    peer?.sendCommand(text);
}
export function startRelay() {
    peer?.startRelay();
}
export function hostViaRelay(sessionID) {
    peer?.hostViaRelay(sessionID);
}
export function userThingChanged(thing) {
    peer?.userThingChanged(thing);
}
//# sourceMappingURL=mudproto.js.map