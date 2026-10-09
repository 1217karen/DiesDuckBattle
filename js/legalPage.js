import { finishPageLoad } from "./pageLoad.js";
import { mountDocumentTabs } from "./documentTabs.js";

mountDocumentTabs({ names: ["terms", "privacy"] });
finishPageLoad();
