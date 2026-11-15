import { bootQuill } from "@distributed-governance/engine/web/shell.jsx";
import { enginePages } from "@distributed-governance/engine/web/engine-pages.jsx";
import { civicPages } from "./civic-pages.jsx";

bootQuill({ pages: [...enginePages, ...civicPages] });
