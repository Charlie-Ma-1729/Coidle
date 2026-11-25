import { render } from "preact";
import { App } from "./App";
import { registerServiceWorker } from "./pwa";
import { startUpdater } from "./updater";
import "./style.css";

render(<App />, document.getElementById("app")!);

registerServiceWorker();
startUpdater();
