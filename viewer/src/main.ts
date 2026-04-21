import { attachPicker } from "./picker";

interface DraftEntry {
  id: string;
  file: string;
  label?: string;
}

interface DraftIndex {
  project: string;
  updated?: string;
  drafts: DraftEntry[];
}

const DATA_ROOT = "/data";

function getCols(): number {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("cols");
  if (!raw) return 2;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return 2;
  return Math.min(n, 6);
}

async function loadProjects(): Promise<{ project: string; index: DraftIndex }[]> {
  // /data is .open-designer/. Drafts live under /data/drafts/<project>/index.json.
  const projects: { project: string; index: DraftIndex }[] = [];
  const projectListRes = await fetch(`${DATA_ROOT}/drafts/`).catch(() => null);

  // Some launchers won't list directories. Accept either:
  //   1. /data/drafts/index.json with { projects: [...] }
  //   2. directory listing fallback
  // The bundled launcher serves option 1.
  try {
    const rootIndexRes = await fetch(`${DATA_ROOT}/drafts/index.json`);
    if (rootIndexRes.ok) {
      const rootIndex = (await rootIndexRes.json()) as { projects: string[] };
      if (Array.isArray(rootIndex.projects)) {
        for (const project of rootIndex.projects) {
          const r = await fetch(`${DATA_ROOT}/drafts/${project}/index.json`);
          if (r.ok) projects.push({ project, index: (await r.json()) as DraftIndex });
        }
        return projects;
      }
    }
  } catch {
    /* fall through */
  }

  // Fallback: parse a basic directory listing if the server returns one.
  if (projectListRes && projectListRes.ok) {
    const html = await projectListRes.text();
    const matches = Array.from(html.matchAll(/href="([^"./?#][^"]*?)\/"/g));
    for (const m of matches) {
      const project = decodeURIComponent(m[1]);
      const r = await fetch(`${DATA_ROOT}/drafts/${project}/index.json`).catch(() => null);
      if (r && r.ok) projects.push({ project, index: (await r.json()) as DraftIndex });
    }
  }

  return projects;
}

function renderEmpty(): void {
  const grid = document.getElementById("grid")!;
  grid.innerHTML = `
    <div class="empty">
      No drafts found yet.<br />
      Ask Claude to design something. Drafts will appear under
      <code>.open-designer/drafts/&lt;project&gt;/</code>.
    </div>
  `;
}

function renderGrid(projects: { project: string; index: DraftIndex }[]): void {
  const grid = document.getElementById("grid")!;
  grid.style.setProperty("--cols", String(getCols()));
  grid.innerHTML = "";

  let total = 0;
  for (const { project, index } of projects) {
    for (const draft of index.drafts) {
      total++;
      const card = document.createElement("article");
      card.className = "draft-card";
      card.innerHTML = `
        <header>
          <span class="label"></span>
          <span class="id"></span>
        </header>
        <iframe loading="lazy"></iframe>
      `;
      const labelEl = card.querySelector(".label") as HTMLElement;
      const idEl = card.querySelector(".id") as HTMLElement;
      const iframe = card.querySelector("iframe") as HTMLIFrameElement;

      labelEl.textContent = draft.label ?? draft.id;
      idEl.textContent = `${project}/${draft.file}`;
      iframe.dataset.project = project;
      iframe.dataset.file = draft.file;
      iframe.src = `${DATA_ROOT}/drafts/${project}/${draft.file}`;

      iframe.addEventListener("load", () => attachPicker(iframe, project, draft.file));
      grid.appendChild(card);
    }
  }

  const counter = document.getElementById("draft-count")!;
  counter.textContent = total === 1 ? "1 draft" : `${total} drafts`;
}

async function refresh(): Promise<void> {
  const projects = await loadProjects();
  if (projects.length === 0) {
    renderEmpty();
    document.getElementById("draft-count")!.textContent = "0 drafts";
    return;
  }
  renderGrid(projects);
}

document.getElementById("refresh-btn")?.addEventListener("click", refresh);

refresh().catch((err) => {
  console.error(err);
  renderEmpty();
});
