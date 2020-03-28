import { SectionState, natTracker, peerTracker, roleTracker, relayTracker, sectionTracker, mudTracker, } from "./base.js";
import * as model from './model.js';
import * as mudcontrol from './mudcontrol.js';
import * as storagecontrol from './storagecontrol.js';
var relaying = false;
var nextId = 0;
export function init(appObj) { }
function $(sel) {
    return typeof sel == 'string' ? document.querySelector(sel) : sel;
}
function $all(sel) {
    return [...document.querySelectorAll(sel)];
}
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
    var res;
    if (typeof el == 'string') {
        res = $all(el);
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
class RadioTracker {
    constructor(tracker, idSuffix) {
        this.tracker = tracker;
        this.idSuffix = idSuffix;
        for (let name of this.tracker.names) {
            for (let node of $all('#' + name.toLowerCase() + this.idSuffix)) {
                node.onclick = evt => this.clicked(evt.target);
            }
        }
        tracker.observe(state => {
            for (let node of $all('#' + this.tracker.currentStateName().toLowerCase() + this.idSuffix)) {
                node.checked = true;
            }
            this.show();
        });
        this.show();
    }
    enumForId(id) {
        return this.tracker.stateForName(id.substring(0, id.length - this.idSuffix.length));
    }
    clicked(button) {
        console.log('New state:::', button.id);
        this.tracker.setValue(this.enumForId(button.id));
    }
    classForEnumName(n) {
        return n.toLowerCase() + this.idSuffix;
    }
    show() {
        console.log('showing emulation state:', this.tracker.currentStateName());
        for (var st of this.tracker.names) {
            document.body.classList.remove(this.classForEnumName(st));
        }
        document.body.classList.add(this.classForEnumName(this.tracker.currentStateName()));
    }
}
function radioTracker(tracker, idSuffix) {
    new RadioTracker(tracker, idSuffix);
}
function setUser(name) {
    document.body.classList.add('hasuser');
}
function cloneTemplate(name) {
    var t = $(name);
    if (t) {
        var node = t.cloneNode(true);
        node.id = null;
        for (let n of $findAll(node, '*')) {
            if (!n.id) {
                n.id = `id-${nextId++}`;
            }
        }
        for (let n of $findAll(node, 'label')) {
            var name = n.getAttribute('for');
            if (name) {
                var target = $find(node, `[name=${name}]`);
                if (target) {
                    n.setAttribute('for', target.id);
                }
            }
        }
        return node;
    }
}
export function showMuds() {
    var worldList = [...model.storage.worlds];
    worldList.sort();
    $('#storage-list').innerHTML = '';
    for (let world of worldList) {
        let div = cloneTemplate('#mud-item-template');
        $('#storage-list').append(div);
        $find(div, '[name=name]').textContent = world;
        div.onclick = async () => editWorld(await model.storage.openWorld(world));
        $find(div, '[name=copy-mud]').onclick = async (evt) => {
            evt.stopPropagation();
            var w = await model.storage.openWorld(world);
            await w.copyWorld(worldCopyName(world));
            showMuds();
        };
        $find(div, '[name=activate-mud]').onclick = async (evt) => {
            evt.stopPropagation();
            $('#mud-output').innerHTML = '';
            sectionTracker.setValue(SectionState.Mud);
            mudcontrol.runMud(await model.storage.openWorld(world));
            $('#mud-name').textContent = world;
        };
    }
}
function worldCopyName(oldName) {
    var nameTemplate = 'Copy of ' + oldName;
    if (model.storage.worlds.indexOf(nameTemplate) == -1) {
        return nameTemplate;
    }
    var counter = 1;
    while (model.storage.worlds.indexOf(nameTemplate + '-' + counter) == -1) {
        counter++;
    }
    return nameTemplate + '-' + counter;
}
export function onEnter(input, action, shouldClear = false) {
    input.onkeydown = evt => {
        if (evt.key == 'Enter') {
            action(input.value);
            if (shouldClear) {
                input.value = '';
            }
        }
    };
}
export async function editWorld(world) {
    let redoUsers = [false];
    let deleted = false;
    let div = cloneTemplate('#mud-editor-template');
    let nameField = $find(div, '[name="mud-name"]');
    let userList = $find(div, '[name=mud-user-list]');
    let success = async () => {
        var name = nameField.value;
        if (name != world.name) {
            await model.storage.renameWorld(world.name, name);
            showMuds();
        }
        if (blobToRevoke) {
            URL.revokeObjectURL(blobToRevoke);
        }
    };
    let blobToRevoke;
    for (let user of await world.getAllUsers()) {
        let div = userItem(user, redoUsers);
        userList.appendChild(div);
    }
    $find(div, '[name=mud-add-user]').onclick = async (evt) => {
        console.log('burp');
        evt.stopPropagation();
        let randomName = await world.randomUserName();
        let password = model.randomName('password');
        let user = { name: randomName, password };
        let userDiv = userItem(user, redoUsers);
        userList.appendChild(userDiv, user);
        redoUsers[0] = true;
    };
    nameField.value = world.name;
    onEnter(nameField, newName => {
        div.remove();
        success();
    });
    $find(div, '[name=download-mud]').onclick = async (evt) => {
        evt.stopPropagation();
        var link = $find(div, '[name=download-mud-link]');
        link.textContent = "Preparing download...";
        var blob = await model.storage.fullBlobForWorld(world.name);
        blobToRevoke = link.href = URL.createObjectURL(blob);
        link.setAttribute('download', world.name + '.json');
        link.textContent = 'Click to download ' + world.name + '.json';
    };
    $find(div, '[name=delete-mud]').onclick = async (evt) => {
        evt.stopPropagation();
        deleted = !deleted;
        div.classList.toggle('mud-deleted');
    };
    try {
        await okCancel(div, '[name=save]', '[name=cancel]', '[name=mud-name]');
        if (!redoUsers[0]) {
            for (let div of userList.children) {
                let nameField = $find(div, '[name=mud-user-name]');
                let passwordField = $find(div, '[name=mud-user-password]');
                let adminCheckbox = $find(div, '[name=mud-user-admin]');
                if (div.originalUser.name != nameField.value
                    || div.originalUser.password != passwordField.value
                    || div.originalUser.admin != adminCheckbox.checked) {
                    redoUsers[0] = true;
                    break;
                }
            }
        }
        if (deleted) {
            console.log("DELETED");
            await model.storage.deleteWorld(world.name);
            showMuds();
            return;
        }
        if (redoUsers[0]) {
            let newUsers = [];
            for (let div of userList.children) {
                var user = div.originalUser;
                user.name = $find(div, '[name=mud-user-name]').value;
                user.password = $find(div, '[name=mud-user-password]').value;
                user.admin = $find(div, '[name=mud-user-admin]').checked;
                newUsers.push(user);
            }
            await world.replaceUsers(newUsers);
        }
        success();
    }
    catch (err) {
        if (blobToRevoke) {
            URL.revokeObjectURL(blobToRevoke);
        }
    }
}
function userItem(user, redoUsers) {
    let { name, password, admin } = user;
    let div = cloneTemplate('#mud-user-item');
    let nameField = $find(div, '[name=mud-user-name]');
    let passwordField = $find(div, '[name=mud-user-password]');
    let adminCheckbox = $find(div, '[name=mud-user-admin]');
    div.originalUser = user;
    nameField.value = name;
    passwordField.value = password;
    adminCheckbox.checked = !!admin;
    $find(div, '[name=delete-user]').onclick = async (evt) => {
        evt.stopPropagation();
        div.remove();
        redoUsers[0] = true;
    };
    return div;
}
export function okCancel(div, okSel, cancelSel, focusSel) {
    document.body.appendChild(div);
    focusSel && setTimeout(() => {
        console.log('focusing ', focusSel, $find(div, focusSel));
        $find(div, focusSel)?.select();
        $find(div, focusSel)?.focus();
    }, 1);
    return new Promise((succeed, fail) => {
        $find(div, okSel).onclick = () => {
            div.remove();
            succeed();
        };
        $find(div, cancelSel).onclick = () => {
            div.remove();
            fail();
        };
    });
}
export function setMudOutput(html) {
    $('#mud-output').innerHTML = html;
}
export function addMudOutput(html) {
    parseHtml(html, $('#mud-output'), (el) => {
        console.log('formatting...');
        for (let node of $findAll(el, '.input')) {
            node.onclick = () => {
                $('#mud-command').value = $find(node, '.input-text').textContent;
                $('#mud-command').select();
                $('#mud-command').focus();
            };
        }
    });
    $('#mud-output').scrollTo(0, $('#mud-output').scrollHeight);
}
export function focusMudInput() {
    $('#mud-command').focus();
}
export function parseHtml(html, receivingNode = null, formatter = null) {
    var parser = $('#parsing');
    parser.innerHTML = html;
    if (parser.children.length == 1) {
        if (formatter)
            formatter(parser.firstChild);
        if (receivingNode) {
            receivingNode.appendChild(parser.firstChild);
        }
        else {
            receivingNode = parser.firstChild;
            receivingNode.remove();
        }
    }
    else {
        if (!receivingNode) {
            receivingNode = document.createElement('div');
        }
        while (parser.firstChild) {
            if (formatter)
                formatter(parser.firstChild);
            receivingNode.appendChild(parser.firstChild);
        }
    }
    return receivingNode;
}
async function uploadMud(evt) {
    var files = evt.target.files;
    if (files.length) {
        for (let file of files) {
            await model.storage.uploadWorld(JSON.parse(await file.text()));
        }
        $('#upload-mud').value = null;
        showMuds();
    }
}
export function start() {
    radioTracker(natTracker, 'Nat');
    radioTracker(peerTracker, 'Peer');
    radioTracker(roleTracker, 'Role');
    radioTracker(relayTracker, 'Relay');
    radioTracker(sectionTracker, 'Section');
    radioTracker(mudTracker, 'Mud');
    sectionTracker.observe(state => {
        if (state == SectionState.Mud) {
            $('#mud-command').focus();
        }
    });
    sectionTracker.setValue(SectionState.Storage);
    $('#user').onblur = () => setUser($('#user').value);
    $('#user').onkeydown = evt => {
        if (evt.key == 'Enter') {
            setUser($('#user').value);
        }
    };
    $('#toggleStatebuttons').onclick = () => document.body.classList.toggle('emulation');
    $('#add-mud-button').onclick = storagecontrol.addMud;
    $('#mud-command').onkeydown = evt => {
        if (evt.key == 'Enter') {
            mudcontrol.command($('#mud-command').value);
            $('#mud-command').value = '';
        }
    };
    $('#upload-mud').onchange = uploadMud;
    showMuds();
}
//# sourceMappingURL=gui.js.map