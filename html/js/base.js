var enumNameMaps = new Map();
export var NatState;
(function (NatState) {
    NatState[NatState["Notstarted"] = 0] = "Notstarted";
    NatState[NatState["Unknown"] = 1] = "Unknown";
    NatState[NatState["Public"] = 2] = "Public";
    NatState[NatState["Private"] = 3] = "Private";
})(NatState || (NatState = {}));
export var RoleState;
(function (RoleState) {
    RoleState[RoleState["Guest"] = 0] = "Guest";
    RoleState[RoleState["Host"] = 1] = "Host";
    RoleState[RoleState["Relay"] = 2] = "Relay";
})(RoleState || (RoleState = {}));
export var RelayState;
(function (RelayState) {
    RelayState[RelayState["Idle"] = 0] = "Idle";
    RelayState[RelayState["PendingHosting"] = 1] = "PendingHosting";
    RelayState[RelayState["Hosting"] = 2] = "Hosting";
})(RelayState || (RelayState = {}));
export var SectionState;
(function (SectionState) {
    SectionState[SectionState["Connection"] = 0] = "Connection";
    SectionState[SectionState["Mud"] = 1] = "Mud";
    SectionState[SectionState["Profile"] = 2] = "Profile";
    SectionState[SectionState["Storage"] = 3] = "Storage";
})(SectionState || (SectionState = {}));
export var PeerState;
(function (PeerState) {
    PeerState[PeerState["disconnected"] = 0] = "disconnected";
    PeerState[PeerState["abortingRelayHosting"] = 1] = "abortingRelayHosting";
    PeerState[PeerState["abortingRelayConnection"] = 2] = "abortingRelayConnection";
    PeerState[PeerState["stoppingHosting"] = 3] = "stoppingHosting";
    PeerState[PeerState["disconnectingFromHost"] = 4] = "disconnectingFromHost";
    PeerState[PeerState["disconnectingFromRelayForHosting"] = 5] = "disconnectingFromRelayForHosting";
    PeerState[PeerState["disconnectingFromRelayForConnection"] = 6] = "disconnectingFromRelayForConnection";
    PeerState[PeerState["connectingToHost"] = 7] = "connectingToHost";
    PeerState[PeerState["connectingToRelayForHosting"] = 8] = "connectingToRelayForHosting";
    PeerState[PeerState["connectingToRelayForConnection"] = 9] = "connectingToRelayForConnection";
    PeerState[PeerState["connectingToRelayForCallback"] = 10] = "connectingToRelayForCallback";
    PeerState[PeerState["awaitingTokenConnection"] = 11] = "awaitingTokenConnection";
    PeerState[PeerState["awaitingToken"] = 12] = "awaitingToken";
    PeerState[PeerState["connectedToHost"] = 13] = "connectedToHost";
    PeerState[PeerState["hostingDirectly"] = 14] = "hostingDirectly";
    PeerState[PeerState["connectedToRelayForHosting"] = 15] = "connectedToRelayForHosting";
    PeerState[PeerState["connectedToRelayForConnection"] = 16] = "connectedToRelayForConnection";
})(PeerState || (PeerState = {}));
export class StateTracker {
    constructor(enumObj) {
        this.names = enumNames(enumObj);
        this.enumType = enumObj;
        this.observers = [];
        this.value = enumObj[this.names[0]];
    }
    setValue(value) {
        this.value = value;
        for (let obs of this.observers) {
            obs(this.value, this);
        }
    }
    setValueNamed(name) {
        this.setValue(this.stateForName(name));
    }
    findEnum(id) {
        id = id.toLowerCase();
        for (var name of this.names) {
            if (id == name.toLowerCase()) {
                return name;
            }
        }
        return '';
    }
    stateForName(name) {
        return this.enumType[this.findEnum(name)];
    }
    nameForState(state) {
        return this.enumType[state];
    }
    currentStateName() {
        return this.nameForState(this.value);
    }
    observe(obs) {
        this.observers.push(obs);
    }
}
function enumNames(enumObj) {
    if (!enumNameMaps.has(enumObj)) {
        var names = Object.keys(enumObj).filter(o => typeof enumObj[o] == 'string').map(o => enumObj[o]);
        enumNameMaps.set(enumObj, names);
        return names;
    }
    return enumNameMaps.get(enumObj);
}
export var natTracker = new StateTracker(NatState);
export var peerTracker = new StateTracker(PeerState);
export var roleTracker = new StateTracker(RoleState);
export var relayTracker = new StateTracker(RelayState);
export var sectionTracker = new StateTracker(SectionState);
//# sourceMappingURL=base.js.map