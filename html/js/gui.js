import { RoleState, RelayState, SectionState, PeerState, MudState, natTracker, peerTracker, roleTracker, relayTracker, sectionTracker, mudTracker, } from "./base.js";
import * as model from './model.js';
import * as mudcontrol from './mudcontrol.js';
import * as storagecontrol from './storagecontrol.js';
import * as mudproto from './mudproto.js';
const jsyaml = window.jsyaml;
let nextId = 0;
export function init(appObj) { }
function $(sel) {
    return typeof sel === 'string' ? document.querySelector(sel) : sel;
}
function $all(sel) {
    return [...document.querySelectorAll(sel)];
}
function $find(el, sel) {
    let res;
    if (typeof el === 'string') {
        res = [...$all(el)];
    }
    else if (el instanceof NodeList) {
        res = [...el];
    }
    else if (el instanceof Node) {
        res = [el];
    }
    if (res.length === 0) {
        return null;
    }
    else if (res.length > 1) {
        for (const node of res) {
            if (node instanceof Element) {
                const result = node.querySelector(sel);
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
    if (Array.isArray(el)) {
        const results = [];
        for (const node of el) {
            results.push(...node.querySelectorAll(sel));
        }
        return results;
    }
    else if (el instanceof HTMLElement) {
        return [...$(el).querySelectorAll(sel)];
    }
    else {
        return [];
    }
}
class CssClassTracker {
    constructor(tracker, idSuffix) {
        this.tracker = tracker;
        this.idSuffix = idSuffix;
        tracker.observe(() => {
            for (const node of $all('#' + this.tracker.currentStateName().toLowerCase() + this.idSuffix)) {
                node.checked = true;
            }
            this.show();
        });
        this.show();
    }
    classForEnumName(n) {
        return n.toLowerCase() + this.idSuffix;
    }
    show() {
        console.log('showing emulation state:', this.tracker.currentStateName());
        for (const st of this.tracker.names) {
            document.body.classList.remove(this.classForEnumName(st));
        }
        document.body.classList.add(this.classForEnumName(this.tracker.currentStateName()));
    }
}
class RadioTracker extends CssClassTracker {
    constructor(tracker, idSuffix) {
        super(tracker, idSuffix);
        for (const name of this.tracker.names) {
            for (const node of $all('#' + name.toLowerCase() + this.idSuffix)) {
                node.onclick = evt => this.clicked(evt.target);
                if (!node.name)
                    node.name = idSuffix + '-radio';
            }
        }
        tracker.observe(() => {
            for (const node of $all('#' + this.tracker.currentStateName().toLowerCase() + this.idSuffix)) {
                node.checked = true;
            }
        });
    }
    enumForId(id) {
        return this.tracker.stateForName(id.substring(0, id.length - this.idSuffix.length));
    }
    clicked(button) {
        console.log('New state:::', button.id);
        this.tracker.setValue(this.enumForId(button.id));
    }
}
function radioTracker(tracker, idSuffix) {
    new RadioTracker(tracker, idSuffix);
}
function setUser(name) {
    document.body.classList.add('hasuser');
}
function cloneTemplate(name) {
    const t = $(name);
    if (t) {
        const node = t.cloneNode(true);
        node.id = null;
        for (const n of $findAll(node, '*')) {
            if (!n.id) {
                n.id = `id-${nextId++}`;
            }
        }
        for (const n of $findAll(node, 'label')) {
            const radioName = n.getAttribute('for');
            if (radioName) {
                const target = $find(node, `[name=${radioName}]`);
                if (target) {
                    n.setAttribute('for', target.id);
                }
            }
        }
        return node;
    }
}
export function showMuds() {
    const worldList = [...model.storage.worlds];
    worldList.sort();
    $('#storage-list').innerHTML = '';
    for (const world of worldList) {
        const div = cloneTemplate('#mud-item-template');
        $('#storage-list').append(div);
        $find(div, '[name=name]').textContent = world;
        div.onclick = async () => editWorld(await model.storage.openWorld(world));
        $find(div, '[name=copy-mud]').onclick = async (evt) => {
            evt.stopPropagation();
            const w = await model.storage.openWorld(world);
            const newName = worldCopyName(world);
            await w.copyWorld(newName);
            showMuds();
            return editWorld(await model.storage.openWorld(newName));
        };
        $find(div, '[name=activate-mud]').onclick = async (evt) => {
            evt.stopPropagation();
            if (mudTracker.value === MudState.NotPlaying) {
                $('#mud-output').innerHTML = '';
                sectionTracker.setValue(SectionState.Mud);
                roleTracker.setValue(RoleState.Solo);
                await mudcontrol.runMud(await model.storage.openWorld(world), text => {
                    addMudOutput('<div>' + text + '</div>');
                });
                $('#mud-name').textContent = world;
            }
            else {
                mudcontrol.quit();
            }
        };
        $find(div, '[name=activate-mud]').setAttribute('mud', world);
    }
}
function worldCopyName(oldName) {
    const oldPrefix = oldName.match(/^Copy( [0-9]+)? of /);
    let newName = oldPrefix ? oldName : `Copy of ${oldName}`;
    let counter = 2;
    if (oldPrefix) {
        oldName = oldName.slice(oldPrefix[0].length);
    }
    while (model.storage.worlds.indexOf(newName) !== -1) {
        newName = `Copy ${counter} of ${oldName}`;
        counter++;
    }
    return newName;
}
export function onEnter(input, action, shouldClear = false) {
    input.onkeydown = evt => {
        if (evt.key === 'Enter') {
            action(input.value);
            if (shouldClear) {
                input.value = '';
            }
        }
    };
}
async function uploadMudExtension(world, editor, evt, changes, ext, item) {
    const files = evt.target.files;
    try {
        if (files.length) {
            for (const file of files) {
                const fileExt = new model.Extension({});
                await fileExt.populate(file);
                if (ext) {
                    if ((await ext.getHash()) === (await fileExt.getHash()) && ext.name === fileExt.name) {
                        return;
                    }
                    const oldName = ext.name;
                    Object.assign(ext, fileExt);
                    ext.name = oldName;
                }
                else {
                    ext = fileExt;
                }
                changes.extensions.add(ext);
                if (item) {
                    populateExtensionItem(world, editor, ext, changes, item);
                }
                else {
                    $find(editor, '[name=mud-extension-list]').appendChild(populateExtensionItem(world, editor, ext, changes));
                }
                break;
            }
        }
    }
    finally {
        evt.target.value = null;
    }
}
function populateExtensionItem(world, editor, ext, changes, item) {
    if (!item) {
        item = cloneTemplate('#mud-extension-item');
    }
    $find(item, '[name=mud-extension-name]').value = ext.name;
    $find(item, '[name=mud-extension-name]').onchange = evt => {
        ext.name = evt.target.value;
        changes.extensions.add(ext);
    };
    $find(item, '[name=mud-extension-hash]').value = ext.hash;
    $find(item, '[name=upload-mud-extension-version]').onchange = async (evt) => {
        await uploadMudExtension(world, editor, evt, changes, ext, item);
    };
    const extBlob = URL.createObjectURL(new Blob([ext.text], { type: 'text/javascript' }));
    changes.blobsToRevoke.add(extBlob);
    $find(item, '[name=save-mud-extension]').href = extBlob;
    $find(item, '[name=delete-mud-extension]').onclick = () => {
        ext.deleted = true;
        changes.extensions.add(ext);
        item.remove();
    };
    return item;
}
async function populateExtensions(world, editor, changes) {
    const extensionDiv = $find(editor, '[name=mud-extension-list]');
    extensionDiv.innerHTML = '';
    for (const ext of await world.getExtensions()) {
        extensionDiv.appendChild(populateExtensionItem(world, editor, ext, changes));
    }
}
export async function editWorld(world) {
    let processUsers = false;
    let deleted = false;
    const div = cloneTemplate('#mud-editor-template');
    const nameField = $find(div, '[name="mud-name"]');
    const userList = $find(div, '[name=mud-user-list]');
    const changes = {
        blobsToRevoke: new Set(),
        extensions: new Set(),
    };
    const success = async () => {
        const name = nameField.value;
        for (const blobToRevoke of changes.blobsToRevoke) {
            URL.revokeObjectURL(blobToRevoke);
        }
        if (deleted) {
            console.log("DELETED");
            await model.storage.deleteWorld(world.name);
            showMuds();
            return;
        }
        if (name !== world.name) {
            await model.storage.renameWorld(world.name, name);
            showMuds();
        }
        if (!processUsers) {
            for (const childDiv of userList.children) {
                const childNameField = $find(childDiv, '[name=mud-user-name]');
                const passwordField = $find(childDiv, '[name=mud-user-password]');
                const adminCheckbox = $find(childDiv, '[name=mud-user-admin]');
                const defaultCheckbox = $find(div, '[name=mud-user-default]');
                if (childDiv.originalUser.name !== childNameField.value
                    || childDiv.originalUser.password !== passwordField.value
                    || childDiv.originalUser.admin !== adminCheckbox.checked
                    || defaultCheckbox.checked !== (world.defaultUser === childDiv.originalUser.name)) {
                    processUsers = true;
                    break;
                }
            }
        }
        if (processUsers) {
            const newUsers = [];
            for (const childDiv of userList.children) {
                const user = childDiv.originalUser;
                user.name = $find(childDiv, '[name=mud-user-name]').value;
                user.password = $find(childDiv, '[name=mud-user-password]').value;
                user.admin = $find(childDiv, '[name=mud-user-admin]').checked;
                if ($find(childDiv, '[name=mud-user-default]').checked) {
                    world.defaultUser = user.name;
                }
                newUsers.push(user);
                await mudcontrol.updateUser(user);
            }
            await world.replaceUsers(newUsers);
        }
        for (const ext of changes.extensions) {
            if (ext.deleted) {
                await world.removeExtension(ext.id);
            }
            else {
                ext.id = await world.addExtension(ext);
            }
        }
        if (changes.extensions.size) {
            world.close();
        }
        changes.extensions.clear();
    };
    const validate = () => {
        return true;
    };
    for (const user of await world.getAllUsers()) {
        const itemDiv = userItem(world, user, () => processUsers = true);
        userList.appendChild(itemDiv);
    }
    await populateExtensions(world, div, changes);
    $find(div, '[name=upload-mud-extension]').onchange = async (evt) => {
        await uploadMudExtension(world, div, evt, changes);
    };
    $find(div, '[name=mud-add-user]').onclick = async (evt) => {
        console.log('burp');
        evt.stopPropagation();
        const randomName = await world.randomUserName();
        const password = model.randomName('password');
        const user = { name: randomName, password };
        const userDiv = userItem(world, user, () => processUsers = true);
        userList.appendChild(userDiv, user);
        $find(userDiv, '[name=mud-user-name]').select();
        $find(userDiv, '[name=mud-user-name]').focus();
        processUsers = true;
    };
    nameField.value = world.name;
    onEnter(nameField, newName => {
        if (validate()) {
            div.remove();
            return success();
        }
    });
    $find(div, '[name=download-mud]').onclick = async (evt) => {
        evt.stopPropagation();
        const link = $find(div, '[name=download-mud-link]');
        link.textContent = "Preparing download...";
        const blob = await model.storage.fullBlobForWorld(world.name);
        changes.blobsToRevoke.add(link.href = URL.createObjectURL(blob));
        link.setAttribute('download', world.name + '.yaml');
        link.textContent = 'Click to download ' + world.name + '.yaml';
    };
    $find(div, '[name=delete-mud]').onclick = async (evt) => {
        evt.stopPropagation();
        deleted = !deleted;
        div.classList.toggle('mud-deleted');
        $find(div, '[name=save]').textContent = deleted ? 'Delete' : 'Save';
    };
    try {
        await okCancel(div, '[name=save]', '[name=cancel]', '[name=mud-name]', validate);
        await success();
    }
    catch (err) { // revoke URL on cancel
        for (const blobToRevoke of changes.blobsToRevoke) {
            URL.revokeObjectURL(blobToRevoke);
        }
    }
}
function userItem(world, user, processUsersFunc) {
    const { name, password, admin } = user;
    const div = cloneTemplate('#mud-user-item');
    const nameField = $find(div, '[name=mud-user-name]');
    const passwordField = $find(div, '[name=mud-user-password]');
    const adminCheckbox = $find(div, '[name=mud-user-admin]');
    const defaultCheckbox = $find(div, '[name=mud-user-default]');
    div.originalUser = user;
    nameField.value = name;
    passwordField.value = password;
    adminCheckbox.checked = !!admin;
    defaultCheckbox.checked = world.defaultUser === user.name;
    $find(div, '[name=delete-user]').onclick = async (evt) => {
        evt.stopPropagation();
        div.remove();
        processUsersFunc();
    };
    return div;
}
export function okCancel(div, okSel, cancelSel, focusSel, validate) {
    document.body.appendChild(div);
    focusSel && setTimeout(() => {
        console.log('focusing ', focusSel, $find(div, focusSel));
        $find(div, focusSel)?.select();
        $find(div, focusSel)?.focus();
    }, 1);
    return new Promise((succeed, fail) => {
        div.onclick = evt => {
            if (evt.target === div) {
                div.remove();
                fail();
            }
        };
        $find(div, okSel).onclick = () => {
            if (validate()) {
                div.remove();
                succeed();
            }
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
        for (const node of $findAll(el, '.input')) {
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
    const parser = $('#parsing');
    parser.innerHTML = html;
    if (parser.children.length === 1) {
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
    const files = evt.target.files;
    if (files.length) {
        for (const file of files) {
            await model.storage.uploadWorld(jsyaml.load(await file.text()));
        }
        $('#upload-mud').value = null;
        showMuds();
    }
}
export function setConnectString(cst) {
    $('#connectString').value = cst;
}
export function setPeerId(id) {
    $('#peerID').textContent = id;
    $('#profilePeerID').textContent = id;
}
export function noConnection() {
    $('#connectStatus').textContent = '';
    $('#connectString').value = '';
    $('#connect').disabled = false;
    $('#connect').textContent = 'Connect';
    $('#toHostID').value = '';
    $('#toHostID').disabled = false;
    $('#toHostID').readOnly = false;
    //$('#send').value = '';
    $('#hostingRelay').readOnly = false;
}
export function connectedToHost(peerID) {
    $('#connectStatus').textContent = 'Connected to ' + peerID;
}
export function connectionRefused(peerID, protocol, msg) {
    $('#toHostID').value = 'Failed to connect to ' + peerID + ' on protocol ' + protocol;
}
export function hosting(protocol) {
    $('#host-protocol').value = 'WAITING TO ESTABLISH LISTENER ON ' + protocol;
}
export function showUsers(userMap) {
    const users = [...userMap.values()];
    users.sort((a, b) => a.name === b.name ? 0 : a.name < b.name ? -1 : 1);
    $('#mud-users').innerHTML = '';
    for (const user of users) {
        const div = cloneTemplate('#mud-connected-user-item');
        div.textContent = user.name;
        div.title = user.peerID;
        $('#mud-users').appendChild(div);
    }
}
function showPeerState(state) {
    $('#direct-connect-string').value = '';
    switch (peerTracker.value) {
        case PeerState.hostingDirectly:
        case PeerState.connectedToRelayForHosting:
            $('#direct-connect-string').value = mudproto.connectString();
            $('#direct-connect-string').select();
            break;
    }
}
function showRoleState(state) {
    if (state === RoleState.Guest) {
        $('#mud-section').classList.add('show-users');
        sectionTracker.setValue(SectionState.Mud);
    }
    else {
        $('#mud-section').classList.remove('show-users');
    }
}
function showMudState(state) {
    const playing = state === MudState.Playing;
    const mudTabButton = $('#mudSection');
    const mudTab = mudTabButton.closest('.tab');
    if (mudTab.classList.contains('disabled') === playing) {
        mudTab.classList.toggle('disabled');
    }
    mudTabButton.disabled = !playing;
    if (playing) {
        sectionTracker.setValue(SectionState.Mud);
        $('#mud-command').removeAttribute('disabled');
        $('#mud-command').focus();
        if (roleTracker.value === RoleState.Host || roleTracker.value === RoleState.Solo) {
            $(`button[mud="${mudcontrol.activeWorld.name}"]`).textContent = 'Quit';
        }
    }
    else {
        for (const button of $all(`button[mud]`)) {
            button.textContent = 'Activate';
        }
        $('#mud-output').innerHTML = '';
        sectionTracker.setValue(SectionState.Storage);
        $('#mud-command').value = '';
        $('#mud-command').setAttribute('disabled', true);
    }
}
function showRelayState(state) {
    if (state === RelayState.PendingHosting) {
        sectionTracker.setValue(SectionState.Connection);
    }
    if (state === RelayState.PendingHosting || state === RelayState.Hosting) {
        $('#relayConnectString').value = mudproto.relayConnectString();
        $('#relayConnectString').select();
        $('#relayConnectString').onclick = evt => {
            setTimeout(() => {
                evt.target.select();
                evt.target.focus();
            }, 1);
        };
    }
}
export function error(msg) {
    alert(`ERROR: ${msg}`);
}
export async function uploadMudFromURL(url) {
    const response = await fetch(url);
    await model.storage.uploadWorld(jsyaml.load(await response.text()));
    showMuds();
    sectionTracker.setValue(SectionState.Storage);
}
export function start() {
    radioTracker(natTracker, 'Nat');
    radioTracker(peerTracker, 'Peer');
    radioTracker(roleTracker, 'Role');
    radioTracker(relayTracker, 'Relay');
    radioTracker(sectionTracker, 'Section');
    radioTracker(mudTracker, 'Mud');
    sectionTracker.observe(state => {
        if (state === SectionState.Mud) {
            $('#mud-command').focus();
        }
    });
    peerTracker.observe(showPeerState);
    mudTracker.observe(showMudState);
    relayTracker.observe(showRelayState);
    roleTracker.observe(showRoleState);
    sectionTracker.setValue(SectionState.About);
    $('#user').onblur = () => setUser($('#user').value);
    $('#user').onkeydown = evt => {
        if (evt.key === 'Enter') {
            setUser($('#user').value);
        }
    };
    $('#toggleStatebuttons').onclick = () => document.body.classList.toggle('emulation');
    $('#add-mud-button').onclick = () => {
        sectionTracker.setValue(SectionState.Storage);
        return storagecontrol.addMud();
    };
    $('#mud-command').onkeydown = async (evt) => {
        if (evt.key === 'Enter') {
            await mudcontrol.executeCommand($('#mud-command').value);
            $('#mud-command').value = '';
        }
    };
    $('#upload-mud').onchange = uploadMud;
    $('#upload-mud').onclick = () => sectionTracker.setValue(SectionState.Storage);
    //$('#upload-mud-extension').onchange = uploadMudExtension
    $('#mud-host').onclick = () => {
        mudproto.startHosting();
    };
    $('#mud-quit').onclick = () => {
        mudproto.reset();
        mudcontrol.quit();
    };
    $('#mud-users-toggle').onclick = () => $('#mud-section').classList.toggle('show-users');
    $('#direct-connect-string').onclick = evt => {
        setTimeout(() => {
            evt.target.select();
            evt.target.focus();
        }, 1);
    };
    $('#connect').onclick = evt => {
        try {
            mudproto.joinSession($('#toHostID').value);
        }
        catch (err) {
            alert('Problem joining: ' + err.message);
        }
    };
    $('#mud-stop-hosting').onclick = mudproto.reset;
    $('#mud-stop-relay').onclick = mudproto.reset;
    $('#mud-select-relay').onclick = () => {
        roleTracker.setValue(RoleState.Relay);
        sectionTracker.setValue(SectionState.Connection);
        mudproto.startRelay();
    };
    $('#mud-select-join').onclick = () => {
        roleTracker.setValue(RoleState.Guest);
        sectionTracker.setValue(SectionState.Connection);
        $('#toHostID').focus();
    };
    $('#mud-request-relay').onclick = () => {
        roleTracker.setValue(RoleState.Host);
        sectionTracker.setValue(SectionState.Connection);
    };
    $('#host-with-relay').onclick = () => {
        mudproto.hostViaRelay($('#hosting-relay-connect-string').value);
    };
    $('#profilePeerID').value = model.storage.profile.peerID;
    $('#profileName').value = model.storage.profile.name;
    $('#profileName').onchange = async () => {
        const prof = model.storage.profile;
        prof.name = $('#profileName').value;
        await prof.store();
    };
    $('#about-frame').contentWindow.textcraft = window.textcraft;
    showMuds();
}
//# sourceMappingURL=gui.js.map