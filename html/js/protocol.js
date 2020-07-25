/* Copyright (c) 2020, William R. Burdick Jr., Roy Riggs, and TEAM CTHLUHU
 *
 * The MIT License (MIT)
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 *
 * This program demonstrate a simple chat application using p2p communication.
 *
 */

// MessagePack MIT licensed from https://github.com/msgpack/msgpack-javascript

/*
# CLIENT-TO-SERVER MESSAGES
 
```
  Start:       [0][KEY: str] -- start peer with optional peer key
  Listen:      [1][FRAMES: 1][PROTOCOL: rest] -- request a listener for a protocol (frames optional)
  Stop:        [2][PROTOCOL: rest] -- stop listening to PROTOCOL
  Close:       [3][ID: 8]                     -- close a stream
  Data:        [4][ID: 8][data: rest]         -- write data to stream
  Connect:     [5][FRAMES: 1][PROTOCOL: STR][RELAY: STR][PEERID: rest] -- connect to another peer (frames optional)
```

# SERVER-TO-CLIENT MESSAGES

```
  Hello:                   [0][STARTED: 1] -- hello message indicates whether the peer needs starting
  Identify:                [1][PUBLIC: 1][PEERID: str][ADDRESSES: str][KEY: rest] -- successful initialization
  Listener Connection:     [2][ID: 8][PEERID: str][PROTOCOL: rest] -- new listener connection with id ID
  Connection Closed:       [3][ID: 8][REASON: rest]            -- connection ID closed
  Data:                    [4][ID: 8][data: rest]              -- receive data from stream with id ID
  Listen Refused:          [5][PROTOCOL: rest]                 -- could not listen on PROTOCOL
  Listener Closed:         [6][PROTOCOL: rest]                 -- could not listen on PROTOCOL
  Peer Connection:         [7][ID: 8][PEERID: str][PROTOCOL: rest] -- connected to a peer with id ID
  Peer Connection Refused: [8][PEERID: str][PROTOCOL: str][ERROR: rest] -- connection to peer PEERID refused
  Protocol Error:          [9][MSG: rest]                      -- error in the protocol
  Listening:               [10][PROTOCOL: rest]                -- confirmation that listening has started
  Access Change:           [11][PUBLIC: 1]                     -- peer access has changed
```
*/
"use strict"
const protPat = /^\/x\//
const peerIDPat = /^[^/]+$/
const bytes = new ArrayBuffer(8);
const numberConverter = new DataView(bytes);

const natStatus = Object.freeze({
    unknown: 'unknown',
    public: 'public',
    private: 'private',
    maybePublic: 'maybePublic',
});

const cmsg = Object.freeze({
    start: 0,
    listen: 1,
    stop: 2,
    close: 3,
    data: 4,
    connect: 5,
});

const smsg = Object.freeze({
    hello: 0,
    ident: 1,
    listenerConnection: 2,
    connectionClosed: 3,
    data: 4,
    listenRefused: 5,
    listenerClosed: 6,
    peerConnection: 7,
    peerConnectionRefused: 8,
    error: 9,
    listening: 10,
    accessChange: 11,
});

const errors = Object.freeze({
    unknownCommand: 0,
    badComand: 1,
    error: 2,
})

var ws;
var peerID;
var utfDecoder = new TextDecoder("utf-8");
var utfEncoder = new TextEncoder("utf-8");

function enumFor(enumObj, value) {
    for (var k in enumObj) {
        if (enumObj[k] == value) return k;
    }
    return null;
}

function sendObject(conID, object) {
    console.log("SENDING COMMAND: " + JSON.stringify(object), object);
    sendString(conID, JSON.stringify(object));
}

function sendString(conID, str) {
    console.log("SENDING STRING TO CONNECTION ", conID, ": ", str)
    sendData(conID, utfEncoder.encode(str));
}

function sendData(conID, data) {
    sendMsg(cmsg.data, { conID: String(conID), data })
}

function connectionError(conID, code, msg, isCatastrophic, extra) {
    var errObj = { name: 'error', code, error: msg };

    if (extra) {
        Object.assign(errObj, extra);
    }
    console.error('Error on connection, ' + msg + (isCatastrophic ? ', closing connection, ' : '') + ', extra information:', extra);
    sendObject(conID, errObj);
    if (isCatastrophic) close(conID);
}


function close(conID) {
    sendMsg(cmsg.close, { conID: String(conID) });
}

function start(port, peerKey = '') {
    sendMsg(cmsg.start, { port, peerKey });
}

function sendMsg(msgType, msg) {
    ws.send(Uint8Array.from([msgType, ...MessagePack.encode(msg)]));
}

function listen(protocol, frames) {
    sendMsg(cmsg.listen, { boolParam: frames, protocol })
}

// stop listening but do not close connections
function stop(protocol, retainConnections) {
    sendMsg(cmsg.stop, { boolParam: retainConnections, protocol })
}

function connect(peerID, prot, frames, relay = false) {
    sendMsg(cmsg.connect, {
        frames,
        relay,
        prot,
        peerID
    });
}

// methods mimic the parameter order of the protocol
class BlankHandler {
    hello(running, thisVersion) { }
    ident(status, peerID, addresses, peerKey, currentVersion) { }
    listenerConnection(conID, peerID, prot) { }
    connectionClosed(conID, msg) { }
    data(conID, data, obj) { }  // obj is optionally a JSON object
    listenRefused(protocol) { }
    listenerClosed(protocol) { }
    peerConnection(conID, peerID, prot) { }
    peerConnectionRefused(peerID, prot, msg) { }
    error(msg) { }
    listening(protocol) { }
    accessChange(access) { }
}

class DelegatingHandler {
    constructor(delegate) {
        this.delegate = delegate;
    }
    tryDelegate(method, args) {
        tryDelegate(this.delegate, method, args);
    }
    hello(running, thisVersion) {
        this.tryDelegate('hello', arguments);
    }
    ident(status, peerID, addresses, peerKey, currentVersion) {
        this.tryDelegate('ident', arguments);
    }
    listenerConnection(conID, peerID, prot) {
        this.tryDelegate('listenerConnection', arguments);
    }
    connectionClosed(conID, msg) {
        this.tryDelegate('connectionClosed', arguments);
    }
    data(conID, data, obj) {
        this.tryDelegate('data', arguments);
    }
    listenRefused(protocol) {
        this.tryDelegate('listenRefused', arguments);
    }
    listenerClosed(protocol) {
        this.tryDelegate('listenerClosed', arguments);
    }
    peerConnection(conID, peerID, prot) {
        this.tryDelegate('peerConnection', arguments);
    }
    peerConnectionRefused(peerID, prot, msg) {
        this.tryDelegate('peerConnectionRefused', arguments);
    }
    error(msg) {
        this.tryDelegate('error', arguments);
    }
    listening(protocol) {
        this.tryDelegate('listening', arguments);
    }
    accessChange(status) {
        this.tryDelegate('accessChange', arguments);
    }
    insertDelegatingHandler(hand) {
        hand.delegate = this.delegate;
        this.delegate = hand;
    }
}

class CommandHandler extends DelegatingHandler {
    constructor(delegate, connections, commands, delegateData, protocols) {
        super(delegate);
        this.connections = connections || this;
        this.commandConnections = new Set();
        this.protocols = new Set(protocols);
        if (commands instanceof Set) {
            this.commands = commands;
        } else if (Array.isArray(commands)) {
            this.commands = new Set(commands);
        } else if (commands instanceof Map) {
            throw new Error('commands is not a map');
        } else if (typeof commands == 'object') {
            this.commands = new Set(Object.keys(commands));
        } else {
            throw new Error('commands is not an object');
        }
        this.delegateData = delegateData;
    }
    // P2P API
    listenerConnection(conID, peerID, prot) {
        if (this.protocols.has(prot)) {
            this.commandConnections.add(conID);
        }
        super.listenerConnection(conID, peerID, prot);
    }
    // P2P API
    connectionClosed(conID, msg) {
        this.commandConnections.delete(conID);
        super.connectionClosed(conID, msg);
    }
    peerConnection(conID, peerID, prot) {
        if (this.protocols.has(prot)) {
            this.commandConnections.add(conID);
        }
        super.peerConnection(conID, peerID, prot);
    }
    // P2P API
    data(conID, data, obj) { // only handle comands for this handler's connections
        var info = getConnectionInfo(this.connections, conID);

        if (typeof obj == 'undefined') {
            try {
                obj = JSON.parse(getString(data));
            } catch (err) {
                if (this.delegateData) {
                    return super.data(conID, data);
                }
                return connectionError(conID, errors.badCommand, 'Bad command, could not parse JSON', true);
            }
        }
        if (this.shouldHandleCommand(info, data, obj)) {
            try {
                if (this.handleCommand(info, data, obj)) {
                    return;
                }
                if (this.delegateData) {
                    super.data(conID, data, obj);
                } else {
                    connectionError(conID, errors.unknownCommand, 'Unknown command: ' + obj.name, true);
                }
            } catch (err) {
                connectionError(conID, errors.error, 'Error during command "' + obj.name + '":\n' + err.stack, true);
            }
        } else {
            super.data(conID, data, obj);
        }
    }
    shouldHandleCommand(info, data, obj) {
        return this.commandConnections.has(info.conID);
    }
    // override this to change how commands are executed
    handleCommand(info, data, obj) {
        if (this.commands.has(obj.name)) {
            console.log("Handling command:", obj);
            this[obj.name](info, obj);
            return true;
        }
        return false;
    }
}

function receivedMessageArgs(type, args) {
    console.log("RECEIVED MESSAGE: ", type, ...args);
}

class LoggingHandler extends DelegatingHandler {
    constructor(delegate) {
        super(delegate);
    }
    ident(status, peerID, addresses, peerKey, currentVersion) {
        receivedMessageArgs('ident', arguments);
        super.ident(status, peerID, addresses, peerKey, currentVersion);
    }
    listenerConnection(conID, peerID, prot) {
        receivedMessageArgs('listenerConnection', arguments);
        super.listenerConnection(conID, peerID, prot);
    }
    connectionClosed(conID, msg) {
        receivedMessageArgs('connectionClosed', arguments);
        super.connectionClosed(conID, msg);
    }
    data(conID, data, obj) {
        receivedMessageArgs('data', arguments);
        super.data(conID, data, obj);
    }
    listenRefused(protocol) {
        receivedMessageArgs('listenRefused', arguments);
        super.listenRefused(protocol);
    }
    listenerClosed(protocol) {
        receivedMessageArgs('listenerClosed', arguments);
        super.listenerClosed(protocol);
    }
    peerConnection(conID, peerID, prot) {
        receivedMessageArgs('peerConnection', arguments);
        super.peerConnection(conID, peerID, prot);
    }
    peerConnectionRefused(peerID, prot, msg) {
        receivedMessageArgs('peerConnectionRefused', arguments);
        super.peerConnectionRefused(peerID, prot, msg);
    }
    error(msg) {
        receivedMessageArgs('error', arguments);
        super.error(msg);
    }
    listening(protocol) {
        receivedMessageArgs('listening', arguments);
        super.listening(protocol)
    }
    accessChange(status) {
        receivedMessageArgs('accessChange', arguments);
        super.accessChange(status)
    }
}

class ConnectionInfo {
    constructor(conID, peerID, protocol, incoming) {
        this.conID = conID;
        this.peerID = peerID;
        this.protocol = protocol;
        this.incoming = incoming;
        this.outgoing = !incoming;
    }
    isRelayHost() { }
    isRelayPeer() { }
    relayInfo() {
        var pending = !this.isRelayPeer() && !isRelayHost();
        var pendingStr = pending ? "PENDING " : " ";
        var html = pendingStr + this.peerID;

        if (this.hostedProtocols && this.hostedProtocols.size) {
            var prots = [...this.hostedProtocols];

            prots.sort();
            html += "HOSTING " + prots.join(", ");
        }
        return {
            pending,
            html,
            peerID: this.peerID,
            rank: this.isRelayHost() ? 1 : pending ? 3 : 2,
            hosting: this.hostedProtocols,
        };
    }
}

class TrackingHandler extends DelegatingHandler {
    constructor(delegate, connections) {
        super(delegate);
        this.connections = connections = connections || delegate || {};
        connections.infoByConID = new Map();
        connections.conIDsByPeerID = new Map();
        connections.natStatus = natStatus.unknown;
        connections.listeningTo = new Set();
    }
    ident(status, peerID, addresses, peerKey, currentVersion) {
        this.connections.peerID = peerID;
        this.connections.natStatus = status;
        super.ident(status, peerID, addresses, peerKey, currentVersion);
    }
    listenerConnection(conID, peerID, prot) {
        var con = new ConnectionInfo(conID, peerID, prot, true);
        var cons = this.connections.conIDsByPeerID.get(peerID);

        this.connections.infoByConID.set(conID, con);
        if (!cons) {
            cons = new Map();
            this.connections.conIDsByPeerID.set(peerID, cons);
        }
        cons.set(conID, prot);
        cons.set(prot, conID);
        super.listenerConnection(conID, peerID, prot);
    }
    connectionClosed(conID, msg) {
        super.connectionClosed(conID, msg);
        cleanupConnections(this.connections, conID);
    }
    listenerClosed(protocol) {
        super.listenerClosed(protocol);
        this.connections.listeningTo.delete(protocol);
    }
    peerConnection(conID, peerID, prot) {
        var con = new ConnectionInfo(conID, peerID, prot, false);
        var conIDs = this.connections.conIDsByPeerID.get(peerID);

        this.connections.infoByConID.set(conID, con);
        if (!conIDs) {
            conIDs = new Map();
            this.connections.conIDsByPeerID.set(peerID, conIDs);
        }
        conIDs.set(conID, prot);
        conIDs.set(prot, conID);
        super.peerConnection(conID, peerID, prot);
    }
    listening(protocol) {
        this.connections.listeningTo.add(protocol);
        super.listening(protocol);
    }
}

/* Commands the relay can receive
 */
const relayServiceCommands = Object.freeze({
    requestHosting: true,
    requestCallback: true,
    requestRelaying: true,
    relay: true,
});

const relayClientCommands = Object.freeze({
    receiveRelay: true,
    receiveRelayCallbackRequest: true,
    receiveRelayConnectionToHost: true,
    receiveRelayConnectionFromPeer: true,
    relayConnectionClosed: true,
});

const relayErrors = Object.freeze({
    hostingNotAllowed: "relayHostingNotAllowed",
    unknownCommand: "unknownRelayCommand",
    badCommand: "badRelayCommand",
    relayingError: "relayingError",
    badProtocol: "badRelayProtocol",
    badCallback: "badCallback",
});

/* Handler that runs a relay service
 *  This is probably more of an "application-layer" class
 *
 *  Listens on a framed protocol for relay commands, which are JSON commands
 *  COMMANDS:
 *   name: 'requestHosting', protocol: PROTOCOL -- a host is requesting relaying
 *   name: 'requestCallback', peerID: peerID, protocol: PROTOCOL, callbackProtocol: PROTOCOL, token: TOKEN -- a public peer is requesting a callback from a relayed host
 *   name: 'requestRelaying', peerID: peerID, protocol: PROTOCOL -- a private peer is requesting relaying to a host
 *   name: 'closeRelayConnection', peerID: PEERID, protocol: PROTOCOL -- a host is closing a connection
 *   name: 'relay', peerID: PEERID, protocol: PROTOCOL, command: COMMAND -- send COMMAND to peer with id PEERID
 *   ---- in the future, we can have an authorize command to restrict peer connections
 *
 *  COMMANDS TO CALLBACK HOSTS:
 *   name: 'callback', peerID: peerID, protocol: PROTOCOL, token: TOKEN -- a private host is accepting a public peer's callback request after connecting to the public peer
 *
 *  COMMANDS TO HOSTS: -- commands to a host, after it has issued an approved host command
 *   name: 'receiveRelayConnection', peerID: PEERID, protocol: PROTOCOL
 *   name: 'receiveRelay', peerID: PEERID, protocol: PROTOCOL, command: COMMAND
 *   name: 'receiveRelayCallbackRequest', peerID: PEERID, protocol: PROTOCOL, callbackProtocol: PROTOCOL, token: TOKEN
 *   name: 'relayConnectionClosed', peerID: PEERID, protocol: PROTOCOL -- relay connection was closed
 */
class RelayService extends CommandHandler {
    // if connections is null, it uses itself for connection information
    constructor(connections, delegate, relayReceiver, relayProtocol) {
        super(delegate, connections, relayServiceCommands, false, [relayProtocol]);
        this.relayReceiver = relayReceiver;
        this.relayReceiver.delegate = delegate;
        this.relayProtocol = relayProtocol;
        this.relayConnections = new Map(); // map of conID -> relay connection info
        this.relayPeers = new Map();       // map of peerID -> relay connection info
        this.allowedPeers = null;          // if not null, a set of peers allowed to connect
        this.allowedHosts = null;          // if not null, a set of [peerID, protocol] to allow hosting
    }
    startRelay() {
        listen(this.relayProtocol, true);
    }
    stopRelay() {
        stop(this.relayProtocol)
    }
    // P2P API
    connectionClosed(conID, msg) {
        var info = getConnectionInfo(this.connections, conID);

        if (this.isRelaying(info)) {
            for (var json of info.connectionsToHosts) {
                var [peerID, protocol] = JSON.parse(json);
                var relayingPeer = this.relayPeers.get(peerID);

                relayingPeer.connectionsFromPeers.delete(json);
            }
            for (var json of info.connectionsFromPeers) {
                var [peerID, protocol] = JSON.parse(json);
                var relayingPeer = this.relayPeers.get(peerID);

                relayingPeer.connectionsToHosts.delete(json);
            }
        }
    }
    // RELAY CMD API
    requestHosting(info, { protocol }) {
        this.getRelayInfo(info);
        if (this.allowedPeers && !this.allowedPeers.has(info.peerID)) {
            connectionError(info.conID, relayErrors.hostingNotAllowed, 'Not allowed to use relay', true);
        } else if (this.allowedHosts && (!this.allowedHosts.has(info.peerID) || this.allowedHosts.get(info.peerID).has(protocol))) {
            connectionError(info.conID, relayErrors.hostingNotAllowed, 'Not allowed to be a relay host for ' + protocol, true);
        } else {
            info.isRelayHost = true;
            this.relayConnections.set(info.conID, info);
            this.relayPeers.set(info.peerID, info);
            info.hostedProtocols.add(protocol);
            tryDelegate(this.relayReceiver, 'requestHosting', arguments);
        }
    }
    // RELAY CMD API
    requestCallback(info, { peerID, protocol, callbackProtocol, token, callbackPeer }) {
        var relayPeer = this.relayPeers.get(peerID);

        if (!relayPeer) {
            connectionError(info.conID, relayErrors.notConnected, 'Relay not connected to requested peer: ' + peerID, true, { peerID });
        } else {
            sendObject(relayPeer.conID, { name: 'receiveRelayCallbackRequest', peerID: info.peerID, protocol, callbackProtocol, token, callbackPeer });
            tryDelegate(this.relayReceiver, 'requestCallback', arguments);
            close(info.conID);
        }
    }
    // RELAY CMD API
    requestRelaying(info, { peerID, protocol }) {
        if (this.allowedPeers && !this.allowedPeers.has(info.peerID)) {
            return connectionError(info.conID, relayErrors.hostingNotAllowed, 'Not allowed to use relay', true);
        }
        var relayPeerInfo = this.relayPeers.get(peerID);

        if (!relayPeerInfo) {
            return connectionError(info.conID, relayErrors.notConnected, 'Relay not connected to requested peer: ' + peerID, true, { peerID });
        }
        this.getRelayInfo(info);
        this.relayPeers.set(info.peerID, info);
        info.connectionsToHosts.add(JSON.stringify([peerID, protocol]));
        relayPeerInfo.connectionsFromPeers.add(JSON.stringify([info.peerID, protocol]));
        sendObject(relayPeerInfo.conID, { name: 'receiveRelayConnectionFromPeer', peerID: info.peerID, protocol });
        sendObject(info.conID, { name: 'receiveRelayConnectionToHost', peerID, protocol });
        tryDelegate(this.relayReceiver, 'requestRelaying', arguments);
    }
    // RELAY CMD API
    closeRelayConnection(info, { peerID, protocol }) {
        var info = getInfoForPeerAndProtocol(this.connections, peerID, protocol);

        if (info) {
            if (!this.isRelaying(info)) {
                connectionError(info.conID, relayErrors.notConnected, 'Not connected to relay', true);
            } else if (!info.hostedProtocols.has(protocol)) {
                connectionError(info.conID, relayErrors.badProtocol, 'Not hosting protocol: ' + protocol, true);
            } else {
                var relayPeer = this.relayPeers.get(peerID);

                if (!relayPeer) return;
                tryDelegate(this.relayReceiver, 'closeRelayConnection', arguments);
                for (var hostJson of relayPeer.connectionsToHosts) {
                    var [rpeerID, rpeerProtocol] = JSON.parse(hostJson);
                    var hostInfoProts = this.connections.conIDsByPeerID.get(rpeerID);
                    var hostInfo;

                    if (hostInfo && (hostInfo = hostInfoProts.get(protocol))) {
                        sendObject(hostInfo.conID, { name: 'relayConnectionClosed', peerID, protocol });
                    }
                }
                info.connectionsFromPeers.delete(JSON.stringify([peerID, protocol]));
                relayPeer.connectionsToHosts.delete(JSON.stringify([info.peerId, protocol]));
                if (relayPeer.hostedProtocols.size == 0 && relayPeer.connectionsToHosts.size == 0 && relayPeer.connectionsFromPeers.size == 0) {
                    close(relayPeer.conID);
                }
            }
        }
    }
    // RELAY CMD API
    relay(info, { peerID, protocol, command }) {
        var relayingPeer = this.relayPeers.get(peerID);
        var key = JSON.stringify([peerID, protocol]);

        if (!this.isRelaying(info)) {
            return connectionError(info.conID, relayErrors.notConnected, 'Not connected to relay', true);
        } else if (!info.connectionsFromPeers.has(key) && !info.connectionsToHosts.has(key)) {
            return connectionError(info.conID, relayErrors.notConnected, 'Not relaying to peer over protocol: ' + protocol, false);
        }
        sendObject(relayingPeer.conID, { name: 'receiveRelay', peerID: info.peerID, protocol, command });
        this.tryDelegate('relay', arguments);
    }
    // RELAY CMD API
    receiveRelay(info, { peerID, command }) {
        this.delegate.handleCommmand(info, null, command);
        tryDelegate(this.relayReceiver, 'receiveRelay', arguments);
    }
    // RELAY CMD API
    receiveRelayCallbackRequest(info, cmd) {
        tryDelegate(this.relayReceiver, 'receiveRelayCallbackRequest', arguments);
    }
    // RELAY CMD API
    receiveRelayConnection(info, cmd) {
        tryDelegate(this.relayReceiver, 'receiveRelayConnection', arguments);
    }
    isRelaying(info) {
        return info && info.hostedProtocols;
    }
    isRelayingToHost(conID, protocol) {
        var info = this.connections.infoByConID.get(conID);

        return info && info.hostedProtocols.has(protocol);
    }
    getRelayInfo(info) {
        if (info && !info.hostedProtocols) {
            info.hostedProtocols = new Set();      // set of protocols the peer is hosting
            info.connectionsToHosts = new Set();   // set of [peerID, protocol] the peer is connected to
            info.connectionsFromPeers = new Set(); // set of [peerID, protocol] relaying to the host
        }
        return info;
    }
    // Allow host peerID to request relaying for protocol
    enableHost(peerID, protocol) {
        if (peerID && protocol) {
            if (this.allowedHosts == null) {
                this.allowedHosts = new Map();
            }
            var prots = this.allowedHosts.get(peerID);
            if (!prots) {
                prots = new Set();
                this.allowedHosts.set(peerID, prots);
            }
            prots.add(protocol);
        }
    }
    disableHost(peerID, protocol) {
        if (peerID && this.allowedHosts) {
            var prots = this.allowedHosts.get(peerID);

            if (prots) {
                if (protocol) {
                    prots.delete(protocol);
                } else {
                    this.allowedHosts.delete(peerID);
                }
            }
        }
    }
    enablePeer(peerID) {
        if (this.allowedPeers == null) {
            this.allowedPeers = new Set();
        }
        if (peerID) {
            this.allowedPeers.add(peerID);
        }
    }
    disablePeer(peerID) {
        if (this.allowedPeers) {
            this.allowedPeers.delete(peerID)
        }
    }
}

class RelayClient extends CommandHandler {
    constructor(connections, handler, delegate, protocol) {
        super(delegate, connections, relayClientCommands, [protocol]);
        this.protocol = protocol;
        this.connections = connections;
        this.handler = handler;
        this.nextConnection = -1;
        this.relayConnectionIds = new Map();
        this.relayConnectionPeers = new Map();
    }
    // RELAY CMD API
    receiveRelay(info, { peerID, protocol, command }) {
        if (!this.handler.handleCommand(getInfoForPeerAndProtocol(this.connections, peerID, protocol), null, command)) {
            this.closeRelayConnection(peerID);
        }
    }
    closeRelayConnection(peerID, protocol) {
        libp2p.sendObject(this.relayConnection, {
            name: 'closeRelayConnection',
            peerID,
            protocol,
        });
        tryDelegate(this.handler, 'closeRelayConnection', arguments);
    }
    // RELAY CMD API
    relayConnectionClosed(info, { peerID, protocol }) {
        var info = getInfoForPeerAndProtocol(this.connections, peerID, protocol);

        if (info) {
            this.connectionClosed(info.conID);
        }
        tryDelegate(this.handler, 'relayConnectionClosed', arguments);
    }
    // P2P API
    connectionClosed(conID, msg) {
        cleanupConnections(this.connections, conID);
    }
    addConnection(peerID, protocol, incoming) {
        var id = this.nextConnection--;
        var ids = this.connections.conIDsByPeerID.get(peerID);
        var info = new ConnectionInfo(id, peerID, protocol, incoming);

        this.relayConnectionIds.set(id, { peerID, protocol });
        this.relayConnectionPeers.set(peerID, { id, protocol });
        this.connections.infoByConID.set(id, info);
        if (!ids) {
            ids = new Map();
            this.connections.conIDsByPeerID.set(peerID, ids);
        }
        ids.set(id, protocol);
        ids.set(protocol, id);
    }
    sendObject(conID, obj) {
        if (conID < 0) {
            var info = this.relayConnectionIds.get(conID);

            if (info) {
                sendObject(this.relayConnection, { name: 'relay', peerID: info.peerID, command: obj });
            } else {
                console.error('attempt to send object to disconnected relay peer', conID);
            }
        } else {
            sendObject(conID, obj);
        }
    }
}

class RelayHost extends RelayClient {
    constructor(connections, handler, delegate, protocol, mainProtocol) {
        super(connections, handler, delegate, protocol);
        this.mainProtocol = mainProtocol;
        this.callbacks = new Map();
    }
    callingBack(conID) {
        var info = this.connections.infoByConID.get(conID);

        return info && this.callbacks.has(info.peerID);
    }
    peerConnection(conID, peerID, prot) {
        super.peerConnection(conID, peerID, prot);
        if (this.callingBack(conID)) {
            sendObject(conID, {
                peerID: this.connections.peerID,
                protocol: this.mainProtocol,
                token: this.callbacks.get(peerID),
            });
            this.callbacks.delete(peerID);
        }
        this.tryDelegate('peerConnection', arguments);
    }
    // RELAY CMD API
    receiveRelayConnectionFromPeer(conID, { peerID, protocol }) {
        this.addConnection(peerID, protocol, true);
        tryDelegate(this.handler, 'receiveRelayConnectionFromPeer', arguments);
    }
    // RELAY CMD API
    receiveRelayCallbackRequest(info, { peerID, protocol, callbackProtocol, token, callbackPeer }) {
        if (this.protocol == this.protocol) {
            this.callbacks.set(peerID, token);
            connect(callbackPeer || peerID, callbackProtocol, true);
            tryDelegate(this.handler, 'receiveRelayCallbackRequest', arguments);
        } else {
            this.closeRelayConnection(info.conID, info.protocol);
        }
    }
}

class RelayPeer extends RelayClient {
    constructor(connections, handler, delegate, protocol) {
        super(connections, handler, delegate, protocol);
    }
    // RELAY CMD API
    receiveRelayConnectionToHost(conID, cmd) {
        this.addConnection(cmd.peerID, cmd.protocol, false);
        tryDelegate(this.handler, 'receiveRelayConnectionToHost', arguments);
    }
}

function tryDelegate(delegate, name, args) {
    if (delegate && name in delegate) {
        delegate[name].apply(delegate, args);
    }
}

function getConnectionInfo(connections, conID) {
    return connections.infoByConID.get(conID);
}

function getInfoForPeerAndProtocol(connections, peerID, protocol) {
    var cons = connections.conIDsByPeerID.get(peerID);

    if (cons && cons.has(cons.get(protocol))) {
        return connections.infoByConID.get(cons.get(protocol));
    }
}

function cleanupConnections(connections, conID) {
    var info = connections.infoByConID.get(conID);

    if (info) {
        var cons = connections.conIDsByPeerID.get(info.peerID);

        if (cons) {
            cons.delete(conID);
            cons.delete(info.protocol);
            if (cons.size == 0) connections.conIDsByPeerID.delete(info.peerID);
        }
    }
    connections.infoByConID.delete(conID);
}

function startProtocol(urlStr, handler) {
    ws = new WebSocket(urlStr);
    ws.onopen = function open() {
        console.log("OPENED CONNECTION, WAITING FOR PEER ID AND NAT STATUS...");
    };
    ws.onerror = err => console.log('Error: ', err);
    ws.onmessage = msg => {
        msg.data.arrayBuffer().then(buf => {
            var msg;
            var data = new Uint8Array(buf);

            try {
                msg = MessagePack.decode(data.slice(1))
            } catch (err) {
                alert(`Bad message. Check console for details`)
                console.log('Bad message from server', data)
                return
            }
            console.log("MESSAGE: [", data.join(", "), "]");
            console.log("TYPE: ", enumFor(smsg, data[0]));
            switch (data[0]) {
                case smsg.hello:
                    handler.hello(msg.started, msg.version);
                    break;
                case smsg.ident:
                    handler.ident(msg.publicPeer ? natStatus.public : natStatus.private, msg.peerID, msg.addresses, msg.peerKey, msg.currentVersion);
                    break;
                case smsg.listenerConnection:
                    handler.listenerConnection(BigInt(msg.conID), msg.peerID, msg.protocol);
                    break;
                case smsg.connectionClosed:
                    handler.connectionClosed(BigInt(msg.conID), msg.reason);
                    break;
                case smsg.data:
                    handler.data(BigInt(msg.conID), msg.data);
                    break;
                case smsg.listenRefused:
                    handler.listenRefused(msg.prot);
                    break;
                case smsg.listenerClosed:
                    handler.listenerClosed(msg.prot);
                    break;
                case smsg.peerConnection:
                    handler.peerConnection(BigInt(msg.conID), msg.peerID, msg.protocol)
                    break;
                case smsg.peerConnectionRefused: {
                    handler.peerConnectionRefused(msg.peerID, msg.protocol, msg.reason);
                    break;
                }
                case smsg.error:
                    handler.error(msg.message);
                    break;
                case smsg.listening:
                    handler.listening(msg.protocol);
                    break;
                case smsg.accessChange:
                    handler.accessChange(
                        msg.access === 0 ? natStatus.unknown
                            : msg.access === 1 ? natStatus.private
                                : msg.access === 2 ? natStatus.public
                                    : natStatus.maybePublic
                    );
                    break;
                default:
                    alert(`Unknown message type ${data[0]}`)
                    break;
            }
        });
    }
    return ws
}

function getCountedStringNext(dv, offset) {
    let str = getCountedString(dv, offset);

    return [str, offset + 2 + str.length];
}

function getCountedString(dv, offset) {
    var start = dv.byteOffset + offset;

    return getString(dv.buffer.slice(start + 2, start + 2 + dv.getUint16(offset)));
}

function getString(buf) {
    return utfDecoder.decode(buf);
}

function checkProt(str) {
    if (!str.match(protPat)) {
        return 'Bad protocol format, protocols must begin with /x/ but this protocol is ' + str;
    }
}

function checkPeerID(str) {
    if (!str.match(peerIDPat)) {
        return 'Bad peer ID format, peer ids must not contain slashes this id is ' + str;
    }
}

///
// base 85 encoding courtesy of Dave Brown, Stackoverflow
// https://stackoverflow.com/a/31741111/1026782
// hacked to remove <~ and ~>
///
function encode_ascii85(a) {
    var b, c, d, e, f, g, h, i, j, k;
    for (!/[^\x00-\xFF]/.test(a), b = "\x00\x00\x00\x00".slice(a.length % 4 || 4), a += b,
        c = [], d = 0, e = a.length; e > d; d += 4) f = (a.charCodeAt(d) << 24) + (a.charCodeAt(d + 1) << 16) + (a.charCodeAt(d + 2) << 8) + a.charCodeAt(d + 3),
            0 !== f ? (k = f % 85, f = (f - k) / 85, j = f % 85, f = (f - j) / 85, i = f % 85,
                f = (f - i) / 85, h = f % 85, f = (f - h) / 85, g = f % 85, c.push(g + 33, h + 33, i + 33, j + 33, k + 33)) : c.push(122);
    return function(a, b) {
        for (var c = b; c > 0; c--) a.pop();
    }(c, b.length), String.fromCharCode.apply(String, c);
}

function decode_ascii85(a) {
    var c, d, e, f, g, h = String, l = "length", w = 255, x = "charCodeAt", y = "slice", z = "replace";
    a = "<~" + a + "~>";
    for ("<~" === a[y](0, 2) && "~>" === a[y](-2), a = a[y](2, -2)[z](/\s/g, "")[z]("z", "!!!!!"),
        c = "uuuuu"[y](a[l] % 5 || 5), a += c, e = [], f = 0, g = a[l]; g > f; f += 5) d = 52200625 * (a[x](f) - 33) + 614125 * (a[x](f + 1) - 33) + 7225 * (a[x](f + 2) - 33) + 85 * (a[x](f + 3) - 33) + (a[x](f + 4) - 33),
            e.push(w & d >> 24, w & d >> 16, w & d >> 8, w & d);
    return function(a, b) {
        for (var c = b; c > 0; c--) a.pop();
    }(e, c[l]), h.fromCharCode.apply(h, e);
}

export default {
    startProtocol,
    start,
    BlankHandler,
    CommandHandler,
    TrackingHandler,
    DelegatingHandler,
    LoggingHandler,
    checkProt,
    checkPeerID,
    sendString,
    sendObject,
    sendData,
    stop,
    listen,
    connect,
    getString,
    close,
    connectionError,
    RelayService,
    RelayClient,
    RelayHost,
    RelayPeer,
    getConnectionInfo,
    encode_ascii85,
    decode_ascii85,
    natStatus,
    getInfoForPeerAndProtocol,
    relayErrors,
    utfDecoder,
    utfEncoder,
}
