var NatState;
(function (NatState) {
    NatState[NatState["Notstarted"] = 0] = "Notstarted";
    NatState[NatState["Unknown"] = 1] = "Unknown";
    NatState[NatState["Public"] = 2] = "Public";
    NatState[NatState["Private"] = 3] = "Private";
})(NatState || (NatState = {}));
var RoleState;
(function (RoleState) {
    RoleState[RoleState["Guest"] = 0] = "Guest";
    RoleState[RoleState["Host"] = 1] = "Host";
    RoleState[RoleState["Relay"] = 2] = "Relay";
})(RoleState || (RoleState = {}));
var RelayState;
(function (RelayState) {
    RelayState[RelayState["Idle"] = 0] = "Idle";
    RelayState[RelayState["PendingHosting"] = 1] = "PendingHosting";
    RelayState[RelayState["Hosting"] = 2] = "Hosting";
})(RelayState || (RelayState = {}));
var PeerState;
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
var relaying = false;
var enumNameMaps = new Map();
function enumNames(enumObj) {
    if (!enumNameMaps.has(enumObj)) {
        var names = Object.keys(enumObj).filter(o => typeof enumObj[o] == 'string').map(o => enumObj[o]);
        enumNameMaps.set(enumObj, names);
        return names;
    }
    return enumNameMaps.get(enumObj);
}
/// simplementation of jQuery
function $(sel) {
    return typeof sel == 'string' ? document.querySelector(sel) : sel;
}
var $all = document.querySelectorAll.bind(document);
function $find(el, sel) {
    var res;
    if (typeof el == 'string') {
        res = [...$all(el)];
    }
    else if (el instanceof NodeList) {
        res = [...el];
    }
    else if (el instanceof Node) {
        res = [el];
    }
    if (res.length == 0) {
        return null;
    }
    else if (res.length > 1) {
        for (var node of res) {
            if (node instanceof Element) {
                var result = node.querySelector(sel);
                if (result)
                    return result;
            }
        }
    }
    else {
        return $(el).querySelector(sel);
    }
}
function $findAll(el, sel) {
    if (typeof el == 'string') {
        el = $all(el);
    }
    if (el instanceof NodeList) {
        el = [...el];
    }
    if (Array.isArray(el)) {
        var results = [];
        for (var node of el) {
            results.push(...node.querySelectorAll(sel));
        }
        return results;
    }
    else {
        return $(el).querySelectorAll(sel);
    }
}
class RadioEnum {
    constructor(enumObj, idSuffix) {
        this.names = enumNames(enumObj);
        this.enumType = enumObj;
        this.idSuffix = idSuffix;
        for (var name of this.names) {
            console.log('name:', name);
            $('#' + name.toLowerCase() + idSuffix).onclick = evt => this.clicked(evt.target);
        }
        this.setValue(enumObj[this.names[0]]);
    }
    setValue(value) {
        this.value = value;
        $('#' + this.enumType[value].toLowerCase() + this.idSuffix).checked = true;
        this.show();
    }
    findEnum(id) {
        id = id.substring(0, id.length - this.idSuffix.length).toLowerCase();
        for (var name of this.names) {
            if (id == name.toLowerCase()) {
                return name;
            }
        }
        return '';
    }
    clicked(button) {
        console.log('New state:::', button.id);
        this.value = this.enumType[this.findEnum(button.id)];
        this.show();
    }
    classForEnumName(n) {
        return n.toLowerCase() + this.idSuffix;
    }
    show() {
        console.log('showing emulation state:', this.enumType[this.value]);
        for (var st of this.names) {
            document.body.classList.remove(this.classForEnumName(st));
        }
        document.body.classList.add(this.classForEnumName(this.enumType[this.value]));
    }
}
var natRadio = new RadioEnum(NatState, 'Nat');
var peerRadio = new RadioEnum(PeerState, 'Peer');
var roleRadio = new RadioEnum(RoleState, 'Role');
var relayRadio = new RadioEnum(RelayState, 'Relay');
function setUser(name) {
    document.body.classList.add('hasuser');
}
function start() {
    $('#user').onblur = () => setUser($('#user').value);
    $('#user').onkeydown = evt => {
        if (evt.key == 'Enter') {
            setUser($('#user').value);
        }
    };
    $('#toggleStatebuttons').onclick = () => document.body.classList.toggle('emulation');
}
window.onload = start;
