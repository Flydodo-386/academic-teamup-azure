import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type Opportunity = { id: number; kind: "Grant" | "Paper"; title: string; owner: string; ownerInitials: string; ownerTone: string; summary: string; tags: string[]; seeking: string; deadline: string; days: number; interest: number; stage: string; accent: string; canRemove?: boolean };
type Grant = { id: string; title: string; funder: string; scheme: string; deadline: string; status: string; themes: string[]; summary: string; url: string | null; minValue?: string; maxValue?: string };
type Profile = { id: string; email: string; name: string; school: string; department: string; bio: string; interests: string[]; expertise: string[]; collaborationTypes: string[]; isViewer?: boolean };
type Viewer = { id: string; name: string; email: string; isAdmin: boolean; initials: string };
type Interest = { id: number; name: string; email: string; role: string; message: string; isPrivate: boolean };
type Modal = "interest" | "post" | "profile" | "import" | null;

const navItems = ["Overview", "Funding", "Paper teams", "People"] as const;

function initials(name: string) { return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "AC"; }

export default function Home() {
  const [activeNav, setActiveNav] = useState<(typeof navItems)[number]>("Overview");
  const [filter, setFilter] = useState<"All" | "Grant" | "Paper">("All");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Opportunity | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [notice, setNotice] = useState("");
  const [saved, setSaved] = useState<number[]>([]);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [feedSource, setFeedSource] = useState<"loading" | "imported" | "empty">("loading");
  const [syncedAt, setSyncedAt] = useState("");
  const [loading, setLoading] = useState(true);
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [importing, setImporting] = useState(false);
  const [importRows, setImportRows] = useState<Array<Record<string, unknown>>>([]);
  const [importName, setImportName] = useState("");
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [viewer, setViewer] = useState<Viewer>({ id: "", name: "Academic colleague", email: "", initials: "AC", isAdmin: false });
  const [csrfToken, setCsrfToken] = useState("");
  const [institutionName, setInstitutionName] = useState("Your institution");
  const [calendarUrl, setCalendarUrl] = useState("");
  const [selectedInterests, setSelectedInterests] = useState<Interest[]>([]);
  const [postDraft, setPostDraft] = useState({ title: "", summary: "", seeking: "", deadline: "", tags: "", kind: "Paper" as "Grant" | "Paper" });

  const showNotice = useCallback((message: string) => { setNotice(message); window.setTimeout(() => setNotice(""), 3600); }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
    const meResponse = await fetch("/api/me", { cache: "no-store" });
    if (meResponse.status === 401) { window.location.assign("/login"); return; }
    if (!meResponse.ok) throw new Error("Unable to load your session.");
    const me = await meResponse.json() as { viewer: Viewer; csrfToken: string; institutionName: string; fundingCalendarUrl: string };
    setViewer({ ...me.viewer, initials: initials(me.viewer.name) });
    setCsrfToken(me.csrfToken); setInstitutionName(me.institutionName); setCalendarUrl(me.fundingCalendarUrl);
    const read = async (path: string) => {
      const response = await fetch(path, { cache: "no-store" });
      if (response.status === 401) window.location.assign("/login");
      if (!response.ok) throw new Error("Unable to load current data. Try Refresh.");
      return response.json();
    };
    const [opportunityResult, grantResult, profileResult] = await Promise.allSettled([
      read("/api/opportunities"), read("/api/grants"), read("/api/profiles"),
    ]);
    if (opportunityResult.status === "fulfilled") {
      const payload = opportunityResult.value as { opportunities?: Opportunity[]; viewer?: { name?: string; email?: string } };
      if (Array.isArray(payload.opportunities)) setOpportunities(payload.opportunities);
    }
    if (grantResult.status === "fulfilled") {
      const payload = grantResult.value as { grants?: Grant[]; source?: typeof feedSource; syncedAt?: string };
      setGrants(payload.grants || []); setFeedSource(payload.source || "empty"); setSyncedAt(payload.syncedAt || "");
    }
    if (profileResult.status === "fulfilled") {
      const payload = profileResult.value as { profiles?: Profile[]; viewer?: { name?: string; email?: string } };
      setProfiles(payload.profiles || []);
    }
    if ([opportunityResult, grantResult, profileResult].some((result) => result.status === "rejected")) showNotice("Some data could not be loaded. Try Refresh.");
    } catch { showNotice("TeamUp could not load your data. Please try again."); }
    finally { setLoading(false); }
  }, [showNotice]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadData(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  useEffect(() => {
    setSelectedInterests([]);
    if (!selected || modal) return;
    const controller = new AbortController();
    void fetch(`/api/opportunities/${selected.id}/interests`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => { if (!response.ok) throw new Error(); return response.json(); })
      .then((payload: { interests: Interest[] }) => setSelectedInterests(payload.interests))
      .catch(() => { if (!controller.signal.aborted) showNotice("Unable to load interest messages."); });
    return () => controller.abort();
  }, [selected, modal, showNotice]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return opportunities.filter((item) => (filter === "All" || item.kind === filter) && (!query || `${item.title} ${item.owner} ${item.summary} ${item.tags.join(" ")} ${item.seeking}`.toLowerCase().includes(query)));
  }, [filter, opportunities, search]);

  const filteredProfiles = useMemo(() => {
    const query = search.trim().toLowerCase();
    return profiles.filter((profile) => !query || `${profile.name} ${profile.department} ${profile.bio} ${profile.interests.join(" ")} ${profile.expertise.join(" ")}`.toLowerCase().includes(query));
  }, [profiles, search]);

  function navigate(item: (typeof navItems)[number]) {
    setActiveNav(item);
    if (item === "Overview") window.scrollTo({ top: 0, behavior: "smooth" });
    if (item === "Funding") document.getElementById("funding")?.scrollIntoView({ behavior: "smooth" });
    if (item === "Paper teams") { setFilter("Paper"); document.getElementById("opportunities")?.scrollIntoView({ behavior: "smooth" }); }
    if (item === "People") document.getElementById("people")?.scrollIntoView({ behavior: "smooth" });
  }

  async function mutate(path: string, method: string, body?: unknown): Promise<{ imported?: number } | null> {
    try {
      const response = await fetch(path, { method, headers: { "content-type": "application/json", "x-csrf-token": csrfToken }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const payload = await response.json() as { error?: string; imported?: number };
      if (response.status === 401) { window.location.assign("/login"); return null; }
      if (!response.ok) { showNotice(payload.error || "Unable to complete this action."); return null; }
      return payload;
    } catch { showNotice("Check your connection and try again."); return null; }
  }

  async function submitInterest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected) return;
    const form = new FormData(event.currentTarget);
    if (!await mutate(`/api/opportunities/${selected.id}/interests`, "POST", { role: form.get("role"), message: form.get("message"), isPrivate: form.get("private") === "on" })) return;
    setModal(null); await loadData(); showNotice("Your expression of interest is available to the opportunity owner.");
  }

  async function submitPost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    if (!await mutate("/api/opportunities", "POST", { kind: form.get("kind"), title: form.get("title"), summary: form.get("summary"), seeking: form.get("seeking"), deadline: form.get("deadline"), tags: form.get("tags") })) return;
    setModal(null); setPostDraft({ title: "", summary: "", seeking: "", deadline: "", tags: "", kind: "Paper" }); await loadData(); showNotice("Your collaboration opportunity is now live.");
  }

  async function removePost(opportunity: Opportunity) {
    if (!opportunity.canRemove || removingId !== null) return;
    if (!window.confirm(`Remove “${opportunity.title}” from the opportunity board?\n\nThe post will be hidden. Its existing interest records will be retained for administrative recovery.`)) return;

    setRemovingId(opportunity.id);
    try {
      if (!await mutate(`/api/opportunities/${opportunity.id}`, "DELETE")) return;
      setOpportunities((current) => current.filter((item) => item.id !== opportunity.id));
      setSaved((current) => current.filter((id) => id !== opportunity.id));
      setSelected((current) => current?.id === opportunity.id ? null : current);
      await loadData();
      showNotice("Your post has been removed from the board.");
    } catch {
      showNotice("Unable to remove your post. Check your connection and try again.");
    } finally {
      setRemovingId(null);
    }
  }

  async function submitProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    if (!await mutate("/api/profiles", "POST", { name: form.get("name"), school: form.get("school"), department: form.get("department"), bio: form.get("bio"), interests: form.get("interests"), expertise: form.get("expertise"), collaborationTypes: form.get("collaborationTypes") })) return;
    setModal(null); await loadData(); showNotice("Your research interests are now visible to colleagues.");
  }

  async function readWorkbook(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    setImportRows([]);
    setImportName(file.name);
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error("Choose a workbook smaller than 5 MB.");
      let rows: Array<Record<string, unknown>>;
      if (file.name.toLowerCase().endsWith(".csv")) {
        const Papa = await import("papaparse");
        const parsed = Papa.default.parse<Record<string, unknown>>(await file.text(), { header: true, skipEmptyLines: "greedy", transformHeader: (value) => value.trim() });
        if (parsed.errors.length) throw new Error("The CSV file has malformed rows or duplicate headers.");
        rows = parsed.data;
      } else {
        const { readSheet } = await import("read-excel-file/universal");
        const data = await readSheet(file);
        const headers = (data[0] || []).map((value) => String(value ?? "").trim());
        if (new Set(headers).size !== headers.length) throw new Error("Workbook column headings must be unique.");
        rows = data.slice(1).filter((row) => row.some((value) => value !== null && value !== "")).map((row) => Object.fromEntries(headers.map((header, index) => {
          const value = row[index];
          return [header, value instanceof Date ? value.toLocaleDateString("en-GB", { timeZone: "UTC" }) : value ?? ""];
        })));
      }
      if (!rows.length || rows.length > 2500) throw new Error("Choose a file containing 1 to 2,500 funding rows.");
      setImportRows(rows); showNotice(`${rows.length} funding rows found in ${file.name}.`);
    } catch (error) { setImportRows([]); showNotice(error instanceof Error ? error.message : "TeamUp could not read that file. Try the Power BI .xlsx export or CSV."); }
  }

  async function submitImport() {
    if (!importRows.length) return showNotice("Choose the Excel export first.");
    setImporting(true);
    const payload = await mutate("/api/grants", "POST", { rows: importRows });
    setImporting(false);
    if (!payload) return;
    setModal(null); setImportRows([]); setImportName(""); await loadData(); showNotice(`${payload.imported || 0} Research Office funding records imported.`);
  }

  function startTeam(grant: Grant) {
    setPostDraft({ kind: "Grant", title: grant.title, summary: grant.summary, seeking: "Co-investigator, methods expertise or impact partner", deadline: grant.deadline, tags: grant.themes.join(", ") });
    setModal("post");
  }

  const viewerProfile = profiles.find((profile) => profile.isViewer);
  const paperCount = opportunities.filter((item) => item.kind === "Paper").length;
  const todayLabel = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "2-digit", month: "long" }).format(new Date()).toUpperCase();

  return <main className="appShell">
    <aside className="sidebar">
      <div className="brand"><div className="brandMark" aria-hidden="true"><span /><span /><span /></div><div><strong>TeamUp</strong><small>Research collaboration</small></div></div>
      <nav aria-label="Primary navigation"><p className="navLabel">Workspace</p>{navItems.map((item) => <button className={activeNav === item ? "navItem active" : "navItem"} key={item} onClick={() => navigate(item)}><span className={`navIcon icon${item.replace(" ", "")}`} aria-hidden="true" /><span>{item}</span>{item === "Funding" && <em>{grants.length || "–"}</em>}</button>)}</nav>
      <div className="sidebarBottom"><div className="pilotCard"><span className="pilotBadge">INSTITUTION WORKSPACE</span><strong>Find the right collaborators</strong><p>Share an idea, request specific expertise, or form a team around a Research Office call.</p></div><button className="profileMini profileButton" onClick={() => setModal("profile")}><span className="avatar avatarPlum">{viewer.initials}</span><span><strong>{viewerProfile?.name || viewer.name}</strong><small>{viewerProfile ? "Profile complete" : "Add research interests"}</small></span><b>›</b></button></div>
    </aside>

    <section className="workspace">
      <header className="topbar"><button className="mobileBrand" aria-label="Home" onClick={() => navigate("Overview")}>T<span>U</span></button><label className="searchBox"><span aria-hidden="true" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search topics, methods or people" aria-label="Search TeamUp" /></label><div className="topActions"><form method="POST" action="/auth/logout"><input type="hidden" name="_csrf" value={csrfToken} /><button className="signOutButton" disabled={!csrfToken}>Sign out</button></form>{viewer.isAdmin && <button className="secondaryTopButton" onClick={() => setModal("import")}>Import funding</button>}<button className="primaryButton" disabled={loading || !csrfToken} onClick={() => { setPostDraft({ title: "", summary: "", seeking: "", deadline: "", tags: "", kind: "Paper" }); setModal("post"); }}><b>＋</b> Post opportunity</button></div></header>
      <div className="content">
        <section className="welcomeRow"><div><p className="eyebrow">{todayLabel}</p><h1>Research moves faster together.</h1><p>{loading ? "Loading the latest collaboration opportunities…" : "Discover funding calls, share paper ideas and find colleagues with complementary expertise."}</p></div><div className="illustration" aria-hidden="true"><span className="orb orbOne" /><span className="orb orbTwo" /><span className="orb orbThree" /><span className="line lineOne" /><span className="line lineTwo" /><span className="line lineThree" /></div></section>
        <section className="metricGrid" aria-label="TeamUp summary"><article className="metricCard"><span className="metricIcon calendarIcon" /><div><small>RESEARCH OFFICE CALLS</small><strong>{grants.length}</strong><p><b>{feedSource === "imported" ? "Imported" : "Ready"}</b> funding feed</p></div></article><article className="metricCard"><span className="metricIcon paperIcon" /><div><small>PAPER COLLABORATIONS</small><strong>{paperCount}</strong><p><b>Open</b> research ideas</p></div></article><article className="metricCard"><span className="metricIcon peopleIcon" /><div><small>COLLEAGUE PROFILES</small><strong>{profiles.length}</strong><p><b>Searchable</b> expertise</p></div></article></section>

        <section className="opportunitySection" id="opportunities">
          <div className="sectionHeading"><div><h2>Team-up opportunities</h2><p>Specific ideas and roles shared by colleagues.</p></div><div className="filterTabs" role="group" aria-label="Filter opportunities">{(["All", "Grant", "Paper"] as const).map((item) => <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item === "All" ? "All" : `${item}s`}</button>)}</div></div>
          <div className="opportunityGrid">
            {filtered.map((item) => <article className={`opportunityCard ${item.accent}`} key={item.id}>
              <div className="cardTop">
                <span className={`kindBadge ${item.kind.toLowerCase()}`}>{item.kind}</span>
                <div className="cardOwnerActions">
                  {item.canRemove && <button className="removePostButton" disabled={removingId !== null} aria-label={`Remove post: ${item.title}`} onClick={() => void removePost(item)}>{removingId === item.id ? "Removing…" : "Remove post"}</button>}
                  <button className={saved.includes(item.id) ? "bookmark saved" : "bookmark"} aria-label="Save opportunity" onClick={() => setSaved((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])} />
                </div>
              </div>
              <button className="cardTitle" onClick={() => setSelected(item)}>{item.title}</button><div className="ownerLine"><span className={`avatar ${item.ownerTone}`}>{item.ownerInitials}</span><span>{item.owner}</span></div><p className="summary">{item.summary}</p><div className="tags">{item.tags.map((tag) => <span key={tag}>{tag}</span>)}</div><div className="seeking"><small>SEEKING</small><p>{item.seeking}</p></div><div className="cardFooter"><span className="deadline"><i /> {item.deadline}</span><button onClick={() => { setSelected(item); setModal("interest"); }}>{item.interest} interested <b>→</b></button></div>
            </article>)}
            {filtered.length === 0 && <div className="emptyState"><strong>{filter === "Paper" ? "No open paper posts yet" : "No matches yet"}</strong><p>{filter === "Paper" ? "Post a research idea to find collaborators." : "Try a broader search or another filter."}</p></div>}
          </div>
        </section>

        <section className="researchFeedSection" id="funding">
          <div className="feedHeading"><div><div className="feedTitleLine"><h2>Research Office funding</h2><span className={`sourceBadge ${feedSource}`}>{feedSource === "imported" ? "Excel imported" : feedSource === "loading" ? "Loading" : "Awaiting import"}</span></div><p>Curated funding calls imported from your Research Office calendar.</p></div><div className="feedActions"><span>{syncedAt ? `Last import ${new Date(syncedAt).toLocaleDateString("en-GB")}` : "No funding imported yet"}</span><button onClick={() => void loadData()}>↻ Refresh</button>{viewer.isAdmin && <button className="connectionButton" onClick={() => setModal("import")}>Import Excel</button>}</div></div>
          <div className="grantTable" role="table" aria-label="Research Office funding opportunities"><div className="grantTableHeader" role="row"><span>Funding opportunity</span><span>Funding range</span><span>Theme</span><span>Deadline</span><span /></div>{grants.filter((grant) => `${grant.title} ${grant.summary} ${grant.funder}`.toLowerCase().includes(search.trim().toLowerCase())).map((grant) => <article className="grantRow" role="row" key={grant.id}><div className="grantIdentity"><span className="grantMark">£</span><span><strong>{grant.title}</strong><small>{grant.summary}</small></span></div><div><strong>{grant.funder}</strong><small>{grant.scheme}</small></div><div className="grantThemes">{grant.themes.slice(0, 2).map((theme) => <span key={theme}>{theme}</span>)}</div><div className="grantDeadline"><strong>{grant.deadline}</strong><small>{grant.status}</small></div><div className="grantActions"><button onClick={() => startTeam(grant)}>Form team</button>{grant.url && <a href={grant.url} target="_blank" rel="noreferrer">Source ↗</a>}</div></article>)}</div>
          {feedSource === "empty" && <div className="feedNotice"><span>i</span><p><strong>Ready for the Research Office export.</strong> An administrator can import the Power BI “Further Details” .xlsx workbook or CSV file.</p>{viewer.isAdmin && <button onClick={() => setModal("import")}>Import now</button>}</div>}
        </section>

        <section className="peopleSection" id="people"><div className="sectionHeading"><div><h2>Find a colleague</h2><p>Discover research interests, methods expertise and preferred ways to collaborate.</p></div><button className="outlineButton" onClick={() => setModal("profile")}>{viewerProfile ? "Edit my profile" : "Create my profile"}</button></div><div className="peopleGrid">{filteredProfiles.slice(0, 8).map((profile) => <article className="personCard" key={profile.id}><div className="personHeader"><span className="avatar avatarPlum">{initials(profile.name)}</span><div><h3>{profile.name}</h3><p>{profile.department || profile.school}</p></div>{profile.isViewer && <small>YOU</small>}</div>{profile.bio && <p className="personBio">{profile.bio}</p>}<div className="personGroup"><b>Research interests</b><div className="tags">{profile.interests.slice(0, 4).map((item) => <span key={item}>{item}</span>)}</div></div><div className="personGroup"><b>Can contribute</b><p>{profile.expertise.join(" · ") || "Profile in progress"}</p></div><a href={`mailto:${profile.email}?subject=TeamUp collaboration enquiry`}>Contact colleague →</a></article>)}{profiles.length === 0 && <div className="peopleEmpty"><strong>Be the first colleague in the directory</strong><p>Add your research interests and the expertise you can offer.</p><button onClick={() => setModal("profile")}>Create profile</button></div>}</div></section>
      </div>
    </section>

    {selected && !modal && <div className="overlay" onMouseDown={() => setSelected(null)}><aside className="detailDrawer" onMouseDown={(event) => event.stopPropagation()}><button className="closeButton" onClick={() => setSelected(null)}>×</button><span className={`kindBadge ${selected.kind.toLowerCase()}`}>{selected.kind}</span><h2>{selected.title}</h2><div className="ownerLine large"><span className={`avatar ${selected.ownerTone}`}>{selected.ownerInitials}</span><span><b>{selected.owner}</b><small>Opportunity owner</small></span></div><div className="detailBlock"><small>ABOUT</small><p>{selected.summary}</p></div><div className="detailBlock"><small>EXPERTISE REQUESTED</small><p>{selected.seeking}</p></div><div className="detailFacts"><span><small>STAGE</small><b>{selected.stage}</b></span><span><small>TIMEFRAME</small><b>{selected.deadline}</b></span></div><button className="drawerPrimary" onClick={() => setModal("interest")}>Express interest privately</button>{selected.canRemove && <section className="interestMessages"><h3>Expressions of interest</h3>{selectedInterests.length === 0 ? <p>No expressions of interest yet.</p> : selectedInterests.map((interest) => <article key={interest.id}><strong>{interest.name}</strong><small>{interest.role} · {interest.isPrivate ? "Private to you" : "Shared"}</small><p>{interest.message}</p>{interest.email && <a href={`mailto:${interest.email}`}>Contact colleague</a>}</article>)}</section>}{selected.canRemove && <button className="drawerSecondary removePostButton" disabled={removingId !== null} onClick={() => void removePost(selected)}>{removingId === selected.id ? "Removing…" : "Remove my post"}</button>}</aside></div>}

    {modal === "interest" && <div className="overlay modalOverlay" onMouseDown={() => setModal(null)}><form className="modalCard" onSubmit={submitInterest} onMouseDown={(event) => event.stopPropagation()}><button type="button" className="closeButton" onClick={() => setModal(null)}>×</button><span className="modalKicker">PRIVATE EXPRESSION OF INTEREST</span><h2>{selected?.title || "Opportunity"}</h2><label>Your preferred contribution<select name="role" required defaultValue=""><option value="" disabled>Select a role</option><option>Co-investigator</option><option>Methods expert</option><option>Data or industry partner</option><option>Paper co-author</option><option>Informal adviser</option></select></label><label>Short message<textarea name="message" required minLength={10} placeholder="Briefly describe the expertise you could offer…" /></label><label className="checkLabel"><input name="private" type="checkbox" defaultChecked /> Keep my interest private from other colleagues</label><button className="drawerPrimary" type="submit">Send expression of interest</button></form></div>}

    {modal === "post" && <div className="overlay modalOverlay" onMouseDown={() => setModal(null)}><form className="modalCard postModal" onSubmit={submitPost} onMouseDown={(event) => event.stopPropagation()}><button type="button" className="closeButton" onClick={() => setModal(null)}>×</button><span className="modalKicker">CREATE AN OPPORTUNITY</span><h2>What would you like to team up on?</h2><div className="choiceRow"><label><input type="radio" name="kind" value="Grant" defaultChecked={postDraft.kind === "Grant"} /> Grant application</label><label><input type="radio" name="kind" value="Paper" defaultChecked={postDraft.kind === "Paper"} /> Research paper</label></div><label>Working title<input name="title" required minLength={5} defaultValue={postDraft.title} placeholder="A clear, specific title" /></label><label>Non-confidential summary<textarea name="summary" required minLength={20} defaultValue={postDraft.summary} placeholder="Describe the idea without sensitive details…" /></label><label>Expertise or roles required<input name="seeking" required defaultValue={postDraft.seeking} placeholder="e.g. causal inference, qualitative methods, Co-I" /></label><div className="twoFields"><label>Deadline or timeframe<input name="deadline" defaultValue={postDraft.deadline} /></label><label>Research themes<input name="tags" defaultValue={postDraft.tags} placeholder="AI, healthcare" /></label></div><button className="drawerPrimary" type="submit">Publish opportunity</button></form></div>}

    {modal === "profile" && <div className="overlay modalOverlay" onMouseDown={() => setModal(null)}><form className="modalCard profileModal" onSubmit={submitProfile} onMouseDown={(event) => event.stopPropagation()}><button type="button" className="closeButton" onClick={() => setModal(null)}>×</button><span className="modalKicker">COLLEAGUE PROFILE</span><h2>Make your expertise discoverable</h2><div className="twoFields"><label>Name<input name="name" required defaultValue={viewerProfile?.name || viewer.name} /></label><label>School / institution<input name="school" defaultValue={viewerProfile?.school || institutionName} /></label></div><label>Department or subject area<input name="department" defaultValue={viewerProfile?.department || ""} placeholder="e.g. Business School, Operations Management" /></label><label>Short research profile<textarea name="bio" defaultValue={viewerProfile?.bio || ""} placeholder="What questions do you work on?" /></label><label>Research interests<input name="interests" required defaultValue={viewerProfile?.interests.join(", ") || ""} placeholder="optimisation, decision science, healthcare" /></label><label>Methods or expertise you can contribute<input name="expertise" defaultValue={viewerProfile?.expertise.join(", ") || ""} placeholder="stochastic modelling, experiments, qualitative methods" /></label><label>Collaboration sought<input name="collaborationTypes" defaultValue={viewerProfile?.collaborationTypes.join(", ") || ""} placeholder="grant Co-I, paper co-author, data partner" /></label><button className="drawerPrimary" type="submit">Save research profile</button></form></div>}

    {modal === "import" && viewer.isAdmin && <div className="overlay modalOverlay" onMouseDown={() => setModal(null)}><div className="modalCard importModal" onMouseDown={(event) => event.stopPropagation()}><button type="button" className="closeButton" onClick={() => setModal(null)}>×</button><span className="modalKicker">RESEARCH OFFICE ADMIN</span><h2>Import the Power BI funding table</h2><ol className="importSteps"><li><span>1</span>Open the Power BI “Further Details” table.</li><li><span>2</span>Use its three-dot menu to export the table to Excel.</li><li><span>3</span>Upload the unedited workbook below. Existing calls are updated automatically.</li></ol><label className="dropZone"><input type="file" accept=".xlsx,.csv" onChange={readWorkbook} /><span>↑</span><strong>{importName || "Choose Excel or CSV file"}</strong><small>{importRows.length ? `${importRows.length} rows ready to import` : "Up to 2,500 rows · duplicates are merged"}</small></label><div className="importFields"><b>Recognised columns</b><p>Funder &amp; Call · Date added · Closing date · Funder Website · Min/Max Application Value · Additional Information · Link to Research Professional</p></div><button className="drawerPrimary" disabled={importing || !importRows.length} onClick={() => void submitImport()}>{importing ? "Importing…" : `Import ${importRows.length || ""} funding records`}</button>{calendarUrl && <a className="powerBiLink" href={calendarUrl} target="_blank" rel="noreferrer">Open institutional funding calendar ↗</a>}</div></div>}

    {notice && <div className="toast" role="status"><span>✓</span>{notice}</div>}
  </main>;
}
