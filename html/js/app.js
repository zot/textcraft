import { NatState, RoleState, RelayState, SectionState, PeerState, natTracker, peerTracker, roleTracker, relayTracker, sectionTracker, } from "./base.js";
let app;
let worker;
export function init(appObj) {
    app = appObj;
    console.log('STARTING WORKER');
    worker = new window.SharedWorker('js/worker.js');
    worker.port.start();
    const msg = new WorkerMessaging();
    worker.port.onmessage = msg.handle.bind(msg);
}
class WorkerMessaging {
    handle(msg) {
        console.log('RECEVING WORKER MESSAGE', msg);
        if (msg.name in this) {
            this[msg.name](msg);
        }
    }
    output({ text }) {
        console.log('Output from worker: ', text);
    }
}
export function sendMessage(msg) {
    console.log('SENDING WORKER MESSAGE', msg);
    worker.port.postMessage(msg);
}
natTracker.observe((state, tracker) => {
    switch (state) {
        case NatState.Notstarted:
            break;
        case NatState.Unknown:
            break;
        case NatState.Public:
            break;
        case NatState.Private:
            break;
    }
});
peerTracker.observe((state, tracker) => {
    switch (state) {
        case PeerState.disconnected:
            break;
        case PeerState.abortingRelayHosting:
            break;
        case PeerState.abortingRelayConnection:
            break;
        case PeerState.stoppingHosting:
            break;
        case PeerState.startingHosting:
            break;
        case PeerState.disconnectingFromHost:
            break;
        case PeerState.disconnectingFromRelayForHosting:
            break;
        case PeerState.disconnectingFromRelayForConnection:
            break;
        case PeerState.connectingToHost:
            break;
        case PeerState.connectingToRelayForHosting:
            break;
        case PeerState.connectingToRelayForConnection:
            break;
        case PeerState.connectingToRelayForCallback:
            break;
        case PeerState.awaitingTokenConnection:
            break;
        case PeerState.awaitingToken:
            break;
        case PeerState.connectedToHost:
            break;
        case PeerState.hostingDirectly:
            break;
        case PeerState.connectedToRelayForHosting:
            break;
        case PeerState.connectedToRelayForConnection:
            break;
    }
});
roleTracker.observe((state, tracker) => {
    switch (state) {
        case RoleState.None:
            break;
        case RoleState.Guest:
            break;
        case RoleState.Host:
            break;
    }
});
relayTracker.observe((state, tracker) => {
    switch (state) {
        case RelayState.Idle:
            break;
        case RelayState.PendingHosting:
            break;
        case RelayState.Hosting:
            break;
    }
});
sectionTracker.observe((state, tracker) => {
    switch (state) {
        case SectionState.Connection:
            break;
        case SectionState.Mud:
            break;
        case SectionState.Profile:
            break;
        case SectionState.Storage:
            break;
    }
});
//# sourceMappingURL=app.js.map