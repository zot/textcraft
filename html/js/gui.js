import { RoleState, RelayState, SectionState, PeerState, MudState, natTracker, peerTracker, roleTracker, relayTracker, sectionTracker, mudTracker, } from "./base.js";
import * as model from './model.js';
import * as mudcontrol from './mudcontrol.js';
import * as storagecontrol from './storagecontrol.js';
import * as mudproto from './mudproto.js';
const jsyaml = window.jsyaml;
let history = [];
let historyPos = 0;
let nextId = 0;
export const exampleMuds = `
Here are some example MUDs you can try:
<ul>
   <li><span class='link' onclick='window.textcraft ? textcraft.Gui.activateMudFromURL("examples/Mystic%20Lands.yaml") : document.location = "examples/Mystic%20Lands.yaml"'>Mystic Lands</span>
   <li><span class='link' onclick='window.textcraft ? textcraft.Gui.activateMudFromURL("examples/Key%20Example.yaml") : document.location = "examples/Key%20Example.yaml"'>Key and Lock</span>
   <li><span class='link' onclick='window.textcraft ? textcraft.Gui.activateMudFromURL("examples/Extension%20Example.yaml") : document.location = "examples/Extension%20Example.yaml"'>Simple Extension</span>
</ul>
<br>
`;
export function init(appObj) { }
function $(sel) {
    return typeof sel === 'string' ? document.querySelector(sel) : sel;
}
function $all(sel) {
    return [...document.querySelectorAll(sel)];
}
function $find(el, sel) {
    let res;
    if (!el)
        return null;
    if (typeof el === 'string') {
        res = [...$all(el)];
    }
    else if (el instanceof NodeList) {
        res = [...el];
    }
    else if ('nodeName' in el) {
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
    else if ('onclick' in el) {
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
    if (!worldList.length) {
        $('#storage-list').innerHTML = `
You have no MUDs in storage, click "Upload" above, to load a MUD from your disk.
<br>
<br>
` + exampleMuds;
        return;
    }
    worldList.sort();
    $('#storage-list').innerHTML = '';
    for (const world of worldList) {
        const div = cloneTemplate('#mud-item-template');
        $('#storage-list').append(div);
        $find(div, '[name=name]').textContent = world;
        div.onclick = () => editWorld(world);
        $find(div, '[name=copy-mud]').onclick = async (evt) => {
            evt.stopPropagation();
            const w = await model.storage.openWorld(world);
            const newName = worldCopyName(world);
            await w.copyWorld(newName);
            showMuds();
            return editWorld(newName);
        };
        $find(div, '[name=activate-mud]').onclick = async (evt) => {
            evt.stopPropagation();
            const playingThis = mudcontrol.connection?.world?.name === world;
            if (mudTracker.value === MudState.Playing) {
                mudcontrol.quit();
            }
            if (!playingThis) {
                return activateMud(await model.storage.openWorld(world));
            }
        };
        $find(div, '[name=activate-mud]').setAttribute('mud', world);
    }
}
async function activateMud(world) {
    $('#mud-output').innerHTML = '';
    sectionTracker.setValue(SectionState.Mud);
    roleTracker.setValue(RoleState.Solo);
    resetHistory();
    await mudcontrol.runMud(world, text => {
        addMudOutput('<div>' + text + '</div>');
    });
    $('#mud-name').textContent = world.name;
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
export async function editWorld(worldName) {
    let world;
    try {
        world = await model.storage.openWorld(worldName);
    }
    catch (err) {
        if (confirm(`Error opening world, delete world?`)) {
            await model.storage.deleteWorld(worldName);
            showMuds();
            return;
        }
    }
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
        for (const childDiv of userList.children) {
            const childNameField = $find(childDiv, '[name=mud-user-name]');
            const passwordField = $find(childDiv, '[name=mud-user-password]');
            const adminCheckbox = $find(childDiv, '[name=mud-user-admin]');
            const defaultCheckbox = $find(childDiv, '[name=mud-user-default]');
            if (childDiv.originalUser.name !== childNameField.value
                || childDiv.originalUser.password !== passwordField.value
                || childDiv.originalUser.admin !== adminCheckbox.checked) {
                processUsers = true;
            }
            if (defaultCheckbox.checked && (world.defaultUser !== childNameField.name)) {
                world.defaultUser = childNameField.value;
                await world.doTransaction(() => world.store());
            }
        }
        if (processUsers) {
            const newUsers = [];
            for (const childDiv of userList.children) {
                const user = childDiv.originalUser;
                user.name = $find(childDiv, '[name=mud-user-name]').value;
                user.password = $find(childDiv, '[name=mud-user-password]').value;
                user.admin = $find(childDiv, '[name=mud-user-admin]').checked;
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
        if (name !== world.name) {
            await model.storage.renameWorld(world.name, name);
            showMuds();
        }
    };
    function validate() {
        return true;
    }
    async function preventAbort() {
        const users = new Map();
        for (const user of await world.getAllUsers()) {
            users.set(user.name, user);
        }
        if (deleted)
            return false;
        if (nameField.value !== world.name)
            return `World name will not change from ${world.name} to ${nameField.value}`;
        for (const childDiv of userList.children) {
            const user = childDiv.originalUser;
            const childNameField = $find(childDiv, '[name=mud-user-name]');
            const passwordField = $find(childDiv, '[name=mud-user-password]');
            const adminCheckbox = $find(childDiv, '[name=mud-user-admin]');
            const defaultCheckbox = $find(childDiv, '[name=mud-user-default]');
            users.delete(user.name);
            if (user.name !== childNameField.value) {
                return `User ${user.name} name will not change to ${childNameField.value}`;
            }
            if (user.password !== passwordField.value) {
                return `User ${user.name} password changed from ${user.password} to ${passwordField.value}`;
            }
            if (user.admin !== adminCheckbox.checked) {
                return `User ${user.name} will ${user.admin ? 'not become' : 'remain'} an admin`;
            }
            if (defaultCheckbox.checked && world.defaultUser !== childNameField.value) {
                return `Default user will not change to ${childNameField.value}`;
            }
        }
        if (users.size > 0) {
            const deletedUsers = [];
            for (const [name, user] of users) {
                deletedUsers.push(name);
            }
            return `The following user${deletedUsers.length > 1 ? 's' : ''} will not be deleted: ${deletedUsers.join(', ')}`;
        }
        return false;
    }
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
        dialog: for (;;) {
            await okCancel(div, '[name=save]', '[name=cancel]', '[name=mud-name]', validate, preventAbort);
            if (!deleted) {
                const userNames = new Set();
                for (const childDiv of userList.children) {
                    const name = $find(childDiv, '[name=mud-user-name]').value;
                    if (userNames.has(name)) {
                        document.body.appendChild(div);
                        alert(`Duplicate user name: ${name}`);
                        continue dialog;
                    }
                    userNames.add(name);
                }
            }
            break;
        }
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
    defaultCheckbox.value = name;
    defaultCheckbox.checked = world.defaultUser === user.name;
    $find(div, '[name=delete-user]').onclick = async (evt) => {
        evt.stopPropagation();
        div.remove();
        processUsersFunc();
    };
    return div;
}
export function okCancel(div, okSel, cancelSel, focusSel, validate, preventAbort) {
    document.body.appendChild(div);
    focusSel && setTimeout(() => {
        console.log('focusing ', focusSel, $find(div, focusSel));
        $find(div, focusSel)?.select();
        $find(div, focusSel)?.focus();
    }, 1);
    return new Promise((succeed, fail) => {
        async function cancel() {
            const msg = await preventAbort();
            if (!msg || confirm(`Cancel?\n\n${msg}`)) {
                div.remove();
                fail();
            }
        }
        div.onclick = evt => {
            if (evt.target === div) {
                return cancel();
            }
        };
        $find(div, okSel).onclick = () => {
            if (validate()) {
                div.remove();
                succeed();
            }
        };
        $find(div, cancelSel).onclick = () => cancel();
    });
}
export function setMudOutput(html) {
    $('#mud-output').innerHTML = html;
}
export function resetHistory() {
    history = [];
    historyPos = 0;
}
export function addMudOutput(html) {
    parseHtml(html, $('#mud-output'), (el) => {
        for (const node of $findAll(el, '.input, .property, .method')) {
            const input = $find(node, '.input-text').textContent.trim();
            const selection = $find(node, '.input-text .select')?.textContent.trim();
            if (node.classList.contains('input')) {
                if (history[historyPos - 1] !== input) {
                    history.push(input);
                    historyPos = history.length;
                }
            }
            node.onclick = () => {
                $('#mud-command').value = input;
                if (input.indexOf('\n') !== -1) {
                    $('#mud-view').classList.add('large-output');
                }
                else {
                    $('#mud-view').classList.remove('large-output');
                }
                if (selection) {
                    $('#mud-command').selectionStart = input.length - selection.length;
                    $('#mud-command').selectionEnd = input.length;
                }
                else {
                    $('#mud-command').select();
                }
                $('#mud-command').focus();
            };
        }
        for (const node of $findAll(el, '.thing')) {
            node.onclick = () => {
                const field = $('#mud-command');
                const cmd = field.value;
                const st = field.selectionStart;
                const txt = node.textContent.match(/^\(?(%[^()]*)\)?$/)[1] + ' ';
                let leading = cmd.substring(0, st);
                if (leading.match(/[^\s$]$/)) {
                    leading += ' ';
                }
                field.value = leading + txt + cmd.substring(field.selectionEnd);
                field.setSelectionRange(st + txt.length, st + txt.length);
                field.focus();
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
        $('#mud-output').innerHTML = `
You haven't activated a MUD.
<br>
Click the Storage tab or <span class='link' onclick='textcraft.Gui.selectStorage()'>click here see the MUDs you have in storage</span>
<br>
<br>` + exampleMuds;
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
export async function activateMudFromURL(url) {
    setTimeout(async () => {
        const response = await fetch(url);
        const world = await model.storage.uploadWorld(jsyaml.load(await response.text()), true);
        if (world) {
            showMuds();
            return activateMud(await model.storage.openWorld(world));
        }
    }, 1);
}
export function displayVersion() {
    const pending = !mudproto.currentVersionID;
    const needsUpdate = mudproto.versionID !== mudproto.currentVersionID;
    const readme = $('iframe');
    const versionEl = $find(readme?.contentDocument?.body, '#versionID');
    if (versionEl) {
        versionEl.innerHTML = `${mudproto.versionID} <b>[${pending ? '...' : needsUpdate ? 'NEWER VERSION AVAILABLE' : 'UP TO DATE'}]</b>`;
    }
}
async function runMudCommand() {
    await mudcontrol.executeCommand($('#mud-command').value);
    setTimeout(() => {
        $('#mud-view').classList.remove('large-output');
        $('#mud-command').value = '';
        $('#mud-command').focus();
    });
}
export function selectStorage() {
    sectionTracker.setValue(SectionState.Storage);
}
export function die(msg) {
    $('#deadMsg').innerHTML = msg;
    $('#dead').classList.remove('hide');
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
        const con = mudcontrol.connection;
        const field = evt.target;
        const livinLarge = $('#mud-view').classList.contains('large-output');
        const modified = evt.shiftKey || evt.ctrlKey || evt.metaKey;
        if (mudTracker.value === MudState.Playing) {
            if (evt.key === 'ArrowUp' && historyPos > 0 && !livinLarge) {
                field.value = history[--historyPos];
                setTimeout(() => field.select(), 1);
            }
            else if (evt.key === 'ArrowDown' && historyPos < history.length && !livinLarge) {
                field.value = history[++historyPos] || '';
                setTimeout(() => field.select(), 1);
            }
            else if (evt.key === 'Escape') {
                $('#mud-view').classList.remove('large-output');
                field.select();
            }
            else if (evt.key === 'Enter' && modified) {
                $('#mud-view').classList.toggle('large-output');
            }
            else if (evt.key === 'Enter' && !livinLarge) {
                await runMudCommand();
            }
        }
    };
    $('#mud-run-command').onclick = runMudCommand;
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
    $('#profilePeerPort').value = model.storage.profile.port || 0;
    $('#profileName').onchange = async () => {
        const prof = model.storage.profile;
        prof.name = $('#profileName').value;
        await prof.store();
    };
    $('#profilePeerPort').onchange = async () => {
        const prof = model.storage.profile;
        const newPort = $('#profilePeerPort').value;
        if (newPort !== prof.port) {
            prof.port = newPort;
            await prof.store();
            alert(`You must restart the program for port changes to take effect
(not just refresh the page)`);
        }
    };
    $('#about-frame').contentWindow.textcraft = window.textcraft;
    showMuds();
}
//# sourceMappingURL=gui.js.map