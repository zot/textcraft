import protoLib from './protocol.js'

namespace proto {
    export type PeerID = string
    export type ConID = number

    export declare var relayErrors: any
    export declare var errors: any

    export declare function connect(peerID: string, protocol: string, frames: boolean)
    export declare function listen(protocol: string, frames: boolean)
    export declare function close(conID: number, callback?: ()=>void)
    export declare function stop(protocol: string, retainConnections: boolean)
    export declare function start(peerKey: string)
    export declare function startProtocol(url: string, handler: P2pHandler)
    export declare function encode_ascii85(str: string): string
    export declare function decode_ascii85(str: string): string
    export declare function connectionError(conID: number, code: string, msg: string, isCatastrophic: boolean, extra?: any)
    export declare function sendObject(conID: number, object: any, callback?: ()=>void)

    export interface P2pHandler {
        hello(running: boolean)
        ident(status, peerID, addresses: string[], peerKey)
        listenerConnection(conID: ConID, peerID: PeerID, protocol: string)
        connectionClosed(conID, msg)
        data(conID, data, obj)        // obj is optionally a JSON obj
        listenRefused(protocol)
        listenerClosed(protocol)
        peerConnection(conID, peerID, prot)
        peerConnectionRefused(peerID, prot, msg)
        error(msg)
        discoveryHostConnect(conID, peerID, prot)
        discoveryPeerConnect(conID, peerID, prot)
        listening(protocol)
        discoveryAwaitingCallback(protocol)
    }
    export declare class DelegatingHandler<H extends P2pHandler> implements P2pHandler {
        delegate: H

        constructor(delegate: H)
        hello(running: boolean)
        ident(status, peerID, addresses, peerKey)
        listenerConnection(conID: ConID, peerID: PeerID, protocol: string)
        connectionClosed(conID, msg)
        data(conID, data, obj)        // obj is optionally a JSON obj
        listenRefused(protocol)
        listenerClosed(protocol)
        peerConnection(conID, peerID, prot)
        peerConnectionRefused(peerID, prot, msg)
        error(msg)
        discoveryHostConnect(conID, peerID, prot)
        discoveryPeerConnect(conID, peerID, prot)
        listening(protocol)
        discoveryAwaitingCallback(protocol)
    }
    export declare class TrackingHandler<H extends P2pHandler> extends DelegatingHandler<H> {
        constructor(delegate: H, connections: any)
    }

    export declare class LoggingHandler<H extends P2pHandler> extends DelegatingHandler<H> {
        constructor(delegate: H)
    }
    export declare class CommandHandler <H extends P2pHandler> extends DelegatingHandler<H> {
        connections: any
        protocols: Set<string>

        constructor(delegate: H, connections: any, commands: any, delegateData: boolean, protocols: string[])
    }
    export declare class RelayHost {
        constructor(connections: any, handler: any, delegate: DelegatingHandler<any>, protocol: string, mainProtocol: string)
    }
}

Object.assign(proto, protoLib) // patch library into typescript namespace, proto

export default proto

