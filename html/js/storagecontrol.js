import * as model from './model.js';
let app;
let gui;
export function init(appObj) {
    app = appObj;
    gui = app.Gui;
}
export async function addMud() {
    const world = await model.storage.openWorld();
    gui.showMuds();
    gui.editWorld(world.name);
}
//# sourceMappingURL=storagecontrol.js.map