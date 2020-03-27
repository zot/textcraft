import * as model from './model.js';
var app;
var gui;
export function init(appObj) {
    app = appObj;
    gui = app.Gui;
}
export async function addMud() {
    var world = await model.storage.openWorld();
    gui.showMuds();
    gui.editWorld(world);
}
//# sourceMappingURL=storagecontrol.js.map