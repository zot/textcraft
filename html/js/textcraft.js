import * as Model from "./model.js";
import * as Gui from "./gui.js";
import * as Mudproto from "./mudproto.js";
import * as App from "./app.js";
import * as StorageControl from "./storagecontrol.js";
import * as MudControl from "./mudcontrol.js";
const app = {
    Model,
    Gui,
    Mudproto,
    App,
    StorageControl,
    MudControl,
};
for (const mod of Object.values(app)) {
    mod.init(app);
}
async function start() {
    await Model.openStorage();
    Gui.start();
    return Mudproto.start(Model.storage);
}
window.onload = start;
//# sourceMappingURL=textcraft.js.map