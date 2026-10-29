(() => {
  'use strict';

  const baseData = window.MHL_BASE_DATA;
  const app = document.getElementById('app');
  const footerSeason = document.getElementById('footer-season');
  let state = JSON.parse(JSON.stringify(baseData));
  let revision = 0;
  let loggedIn = false;
  let saving = false;
  let galleryPhotos = [];
  const staticGallery = Array.from({length:5},(_,i)=>({id:'static-'+(i+1),src:'assets/hockey-'+(i+1)+'.jpg',alt:'Hockeymiljøet i MHL'}));
  function shuffledPhotos(items) {
    const out=items.slice();
    for(let i=out.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[out[i],out[j]]=[out[j],out[i]];}
    return out.slice(0,5);
  }
  function galleryMarkup(){
    const items=galleryPhotos.some(p=>p.active) ? shuffledPhotos(galleryPhotos.filter(p=>p.active)) : shuffledPhotos(staticGallery);
    return items.map((photo,i)=>`<button type="button" class="photo-tile" aria-label="Vis bilde ${i+1} i stort format" data-photo-id="${e(photo.id)}"><img src="${e(photo.src)}" alt="${e(photo.alt||'Hockeymiljøet i MHL')}" loading="lazy"><span class="photo-tile-overlay">SE BILDE <b>↗</b></span></button>`).join('');
  }
  async function loadGallery(){
    try {const result=await fetchJSON('/api/photos');galleryPhotos=Array.isArray(result.photos)?result.photos:[];}
    catch {galleryPhotos=[];}
  }
  function adminGalleryMarkup(){
    return `<article class="panel admin-panel admin-wide"><div class="panel-header"><h3>Bildebibliotek</h3></div><div class="stack-form">
      <p class="form-hint">Last opp JPG, PNG, WEBP eller AVIF (maks 6 MB). Aktive bilder velges tilfeldig på forsiden hver gang den åpnes. Bildene lagres i R2, oversikten i D1.</p>
      <form id="photo-form" class="stack-form" style="padding:0"><label>Velg bilde<input type="file" name="photo" accept="image/jpeg,image/png,image/webp,image/avif" required></label><label>Bildetekst<input type="text" name="alt" maxlength="180" placeholder="Beskriv bildet kort" required></label><button class="btn" type="submit">Last opp bilde</button></form>
      <div class="admin-photo-list">${galleryPhotos.map(p=>`<div class="admin-photo-item"><img src="${e(p.src)}" alt="${e(p.alt)}" loading="lazy"><div><strong>${e(p.alt)}</strong><small>${p.active?'Vises i bildebiblioteket':'Skjult fra forsiden'}</small></div><button class="ghost-btn" type="button" data-photo-toggle="${e(p.id)}" data-active="${p.active?0:1}">${p.active?'Skjul':'Aktiver'}</button><button class="ghost-btn" type="button" data-photo-delete="${e(p.id)}">Slett</button></div>`).join('')}</div>
    </div></article>`;
  }


  function clone(obj) { return JSON.parse(JSON.stringify(obj)); }
  function isLoggedIn() { return loggedIn; }
  function setLoggedIn(value) { loggedIn = Boolean(value); }
  async function fetchJSON(path, options={}) {
    const response = await fetch(path,{credentials:'same-origin',cache:'no-store',...options});
    const json = await response.json().catch(()=>({error:'Ugyldig svar fra server'}));
    if (!response.ok) { const error = new Error(json.error || 'Serverfeil');error.status=response.status;throw error; }
    return json;
  }
  async function loadRemoteData() {
    const result = await fetchJSON('/api/state');
    state = result.data;revision = result.revision;
    const session = await fetchJSON('/api/session');
    setLoggedIn(session.authenticated);
    await loadGallery();
    route();
  }
  async function saveData() {
    if(saving){ alert('En lagring pågår. Forsøk igjen om et øyeblikk.');return; }
    saving=true;
    try {
      const response = await fetchJSON('/api/state', {
        method:'PUT',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({revision,data:state})
      });
      revision = response.revision;
    } catch(err) {
      alert('Lagring mislyktes: '+err.message+' — siden oppdateres fra databasen.');
      try { await loadRemoteData(); } catch (_) {}
    } finally { saving=false; }
  }
  async function resetData() {
    state=clone(baseData);await saveData();route();
  }

  function e(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[ch]));
  }

  function slugify(value) {
    return String(value || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function getTeam(id) {
    return state.teams.find(team => team.id === id);
  }

  function getPlayer(id) {
    return state.players.find(player => player.id === id);
  }

  function formatDate(dateString) {
    if (!dateString) return 'Dato ikke registrert';
    const parts = String(dateString).split('-');
    return parts.length === 3 ? `${parts[2]}.${parts[1]}.${parts[0]}` : dateString;
  }

  function sortMatches(list) {
    return list.slice().sort((a, b) => {
      if (a.date && b.date) return b.date.localeCompare(a.date);
      if (a.date) return -1;
      if (b.date) return 1;
      return String(b.id).localeCompare(String(a.id));
    });
  }

  function teamStyle(team) {
    return `--team:${e(team.color || '#d4a017')}`;
  }

  function badge(team) {
    return `<span class="mini-badge" style="${teamStyle(team)}">${e(team.initials || team.short || team.name.slice(0, 3))}</span>`;
  }

  function ensurePlayer(teamId, number) {
    const normalized = Number(number);
    if (!teamId || !Number.isFinite(normalized)) return null;
    const existing = state.players.find(player => player.teamId === teamId && Number(player.number) === normalized);
    if (existing) return existing.id;
    const team = getTeam(teamId);
    const id = `${teamId}-${normalized}-${Date.now().toString(36)}`;
    state.players.push({
      id,
      teamId,
      number: normalized,
      name: `${team ? team.name : 'Spiller'} #${normalized}`,
      position: 'F',
      shutouts: 0
    });
    return id;
  }

  function summarize() {
    const playerTotals = new Map();
    state.players.forEach(player => {
      playerTotals.set(player.id, {
        ...player,
        goals: 0,
        assists: 0,
        pim: 0,
        points: 0,
        shutouts: Number(player.shutouts) || 0
      });
    });

    state.matches.forEach(match => {
      (match.goalEvents || []).forEach(goal => {
        if (goal.scorerPlayerId && playerTotals.has(goal.scorerPlayerId)) {
          playerTotals.get(goal.scorerPlayerId).goals += 1;
        }
        (goal.assistPlayerIds || []).forEach(assistId => {
          if (assistId && playerTotals.has(assistId)) {
            playerTotals.get(assistId).assists += 1;
          }
        });
      });
      (match.penalties || []).forEach(penalty => {
        if (penalty.playerId && playerTotals.has(penalty.playerId)) {
          playerTotals.get(penalty.playerId).pim += Number(penalty.minutes) || 2;
        }
      });
    });

    const players = Array.from(playerTotals.values()).map(player => ({
      ...player,
      points: player.goals + player.assists,
      team: getTeam(player.teamId)
    }));

    const standings = state.teams.map(team => {
      const record = {
        team,
        gp: 0,
        w: 0,
        d: 0,
        l: 0,
        gf: 0,
        ga: 0,
        pts: 0
      };
      state.matches.forEach(match => {
        if (match.home !== team.id && match.away !== team.id) return;
        if (!Number.isFinite(Number(match.homeGoals)) || !Number.isFinite(Number(match.awayGoals))) return;
        const isHome = match.home === team.id;
        const goalsFor = isHome ? Number(match.homeGoals) : Number(match.awayGoals);
        const goalsAgainst = isHome ? Number(match.awayGoals) : Number(match.homeGoals);
        record.gp += 1;
        record.gf += goalsFor;
        record.ga += goalsAgainst;
        if (goalsFor > goalsAgainst) {
          record.w += 1;
          record.pts += 2;
        } else if (goalsFor < goalsAgainst) {
          record.l += 1;
        } else {
          record.d += 1;
          record.pts += 1;
        }
      });
      return record;
    }).sort((a, b) => (
      b.pts - a.pts || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf || a.team.name.localeCompare(b.team.name)
    ));

    const leaders = {
      goals: players.slice().sort((a, b) => b.goals - a.goals || b.assists - a.assists || a.name.localeCompare(b.name)).slice(0, 3),
      assists: players.slice().sort((a, b) => b.assists - a.assists || b.goals - a.goals || a.name.localeCompare(b.name)).slice(0, 3),
      points: players.slice().sort((a, b) => b.points - a.points || b.goals - a.goals || a.name.localeCompare(b.name)).slice(0, 3),
      pim: players.slice().sort((a, b) => b.pim - a.pim || a.name.localeCompare(b.name)).slice(0, 3),
      shutouts: players.filter(player => (player.position || '').toUpperCase() === 'GK' || player.shutouts > 0)
        .sort((a, b) => b.shutouts - a.shutouts || a.name.localeCompare(b.name)).slice(0, 3)
    };

    return {
      players,
      standings,
      leaders,
      posts: state.posts.slice().sort((a, b) => {
        if ((a.pinned ? 1 : 0) !== (b.pinned ? 1 : 0)) return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
        return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
      }),
      matches: sortMatches(state.matches)
    };
  }

  function sectionHead(label, title, linkHref, linkLabel) {
    return `
      <div class="section-head">
        <div>
          <div class="eyebrow">${e(label)}</div>
          <h2>${e(title)}</h2>
        </div>
        ${linkHref ? `<a class="text-link" href="${e(linkHref)}">${e(linkLabel)} →</a>` : ''}
      </div>
    `;
  }

  function pageBanner(label, title, body) {
    return `
      <section class="page-banner">
        <div class="container">
          <div class="eyebrow">${e(label)}</div>
          <h1 class="page-title">${e(title)}</h1>
          <p>${e(body)}</p>
        </div>
      </section>
    `;
  }

  function teamCard(team) {
    return `
      <a class="team-card" href="#/team/${encodeURIComponent(team.id)}" style="${teamStyle(team)}">
        <span class="cross-mark"></span>
        <div class="team-card-top">
          <div class="team-badge">${e(team.initials)}</div>
          <div>
            <small>${e(team.city)}</small>
            <h3>${e(team.name)}</h3>
          </div>
        </div>
        <p class="team-venue">HJEMMEBANE · ${e(team.venue || "Ikke registrert")}</p>
        <p>${e(team.description)}</p>
        <span class="team-link">Se lagside</span>
      </a>
    `;
  }

  function postsMarkup(posts) {
    if (!posts.length) return `<div class="empty">Ingen publiseringer registrert ennå.</div>`;
    return `<div class="posts-feed">${posts.map(post => `
      <article class="post-card">
        <div class="post-meta">
          <span>${post.pinned ? 'Festet innlegg' : 'Publisering'}</span>
          <span>${e(formatDate((post.createdAt || '').slice(0, 10)))}</span>
        </div>
        <h3>${e(post.title)}</h3>
        <p>${e(post.content)}</p>
        <small>Publisert av ${e(post.author || 'MHL')}</small>
      </article>
    `).join('')}</div>`;
  }

  function standingsTable(standings) {
    return `
      <div class="panel table-scroll">
        <table class="league-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Lag</th>
              <th>K</th>
              <th>S</th>
              <th>U</th>
              <th>T</th>
              <th>MF</th>
              <th>MM</th>
              <th>+/-</th>
              <th>P</th>
            </tr>
          </thead>
          <tbody>
            ${standings.map((row, index) => `
              <tr>
                <td class="rank">${index + 1}</td>
                <td><a class="team-cell" href="#/team/${e(row.team.id)}">${badge(row.team)}${e(row.team.name)}</a></td>
                <td>${row.gp}</td>
                <td>${row.w}</td>
                <td>${row.d}</td>
                <td>${row.l}</td>
                <td>${row.gf}</td>
                <td>${row.ga}</td>
                <td>${row.gf - row.ga > 0 ? '+' : ''}${row.gf - row.ga}</td>
                <td>${row.pts}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function leaderBlock(title, statKey, unit, items) {
    return `
      <article class="leader-card">
        <h3>${e(title)}</h3>
        ${items.length ? items.map((item, index) => `
          <div class="leader-row">
            <span class="leader-place">${index + 1}</span>
            <div class="leader-body">
              <strong>${e(item.name)}</strong>
              <small>${e(item.team ? item.team.name : 'Ukjent lag')} · #${e(item.number)}</small>
            </div>
            <span class="leader-score">${e(item[statKey] ?? 0)} <small>${e(unit)}</small></span>
          </div>
        `).join('') : `<div class="empty">Ingen registrerte tall ennå.</div>`}
      </article>
    `;
  }

  function leadersGrid(leaders) {
    return `
      <div class="leader-grid">
        ${leaderBlock('Mål', 'goals', 'mål', leaders.goals)}
        ${leaderBlock('Assists', 'assists', 'assist', leaders.assists)}
        ${leaderBlock('Målpoeng', 'points', 'poeng', leaders.points)}
        ${leaderBlock('Utvisningsminutter', 'pim', 'min', leaders.pim)}
        ${leaderBlock('Clean sheets / Shutouts', 'shutouts', 'SO', leaders.shutouts)}
      </div>
    `;
  }

  function resultsList(matches) {
    if (!matches.length) return `<div class="empty">Ingen kamper registrert.</div>`;
    return `<div class="results-list">${matches.map(match => {
      const home = getTeam(match.home);
      const away = getTeam(match.away);
      return `
        <a href="#/match/${encodeURIComponent(match.id)}" class="result-card result-link">
          <div class="result-top">
            <span>${e(match.label || 'Seriekamp')}</span>
            <span>${e(formatDate(match.date))}</span>
          </div>
          <div class="result-body">
            <div>
              <div class="matchup">${e(home.name)} – ${e(away.name)}</div>
              <small>${match.goalEvents?.length || 0} scoringer · ${match.penalties?.length || 0} utvisninger</small>
            </div>
            <div class="scoreline">${e(match.homeGoals)}–${e(match.awayGoals)}</div>
          </div>
        </a>
      `;
    }).join('')}</div>`;
  }

  function valuesGrid() {
    return `
      <div class="values-grid">
        ${state.values.map(value => `
          <article class="value-card">
            <span class="value-cross"></span>
            <h3>${e(value.title)}</h3>
            <p>${e(value.body)}</p>
          </article>
        `).join('')}
      </div>
    `;
  }

  function fullStatsTable(players) {
    const sorted = players.slice().sort((a, b) => b.points - a.points || b.goals - a.goals || a.name.localeCompare(b.name));
    return `
      <div class="panel table-scroll">
        <table class="league-table">
          <thead>
            <tr>
              <th>Spiller</th>
              <th>Lag</th>
              <th>#</th>
              <th>Mål</th>
              <th>Assist</th>
              <th>Poeng</th>
              <th>Utv.min</th>
              <th>SO</th>
            </tr>
          </thead>
          <tbody>
            ${sorted.map(player => `
              <tr>
                <td>${e(player.name)}</td>
                <td><a class="team-cell" href="#/team/${e(player.teamId)}">${badge(player.team)}${e(player.team ? player.team.name : '')}</a></td>
                <td>${e(player.number)}</td>
                <td>${player.goals}</td>
                <td>${player.assists}</td>
                <td>${player.points}</td>
                <td>${player.pim}</td>
                <td>${player.shutouts}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function matchPage(matchId) {
    const match = state.matches.find(item => item.id === matchId);
    if (!match) return renderPage('Kamp ikke funnet', pageBanner('Kamp', 'Ikke funnet', 'Vi fant ingen kamp med denne ID-en.'));
    const home = getTeam(match.home);
    const away = getTeam(match.away);
    const goals = (match.goalEvents || []).slice().sort((a,b) => a.period-b.period || String(a.time).localeCompare(String(b.time)));
    const penalties = (match.penalties || []).slice().sort((a,b) => a.period-b.period || String(a.time).localeCompare(String(b.time)));
    const fmtPlayer = id => { const player = getPlayer(id); return player ? `${player.name} (#${player.number})` : 'Ikke registrert'; };
    renderPage(`${home?.name || '?'} – ${away?.name || '?'}`, `
      ${pageBanner('Kamprapport', `${home?.name || '?'} ${match.homeGoals} – ${match.awayGoals} ${away?.name || '?'}`, `${match.label || 'Seriekamp'} · ${formatDate(match.date)}`)}
      <section class="section"><div class="container">
        <a class="back-link" href="#/">← Til forsiden</a>
        ${sectionHead('Kampens hendelser', 'Scoringer')}
        <div class="panel table-scroll"><table class="league-table"><thead><tr><th>Periode</th><th>Tid</th><th>Lag</th><th>Målscorer</th><th>Assist</th></tr></thead><tbody>${goals.map(g => `<tr><td>${e(g.period)}</td><td>${e(g.time)}</td><td>${e(getTeam(g.teamId)?.name || '')}</td><td>${e(fmtPlayer(g.scorerPlayerId))}</td><td>${e((g.assistPlayerIds || []).map(fmtPlayer).join(', ') || '—')}</td></tr>`).join('')}</tbody></table></div>
      </div></section><section class="section alt"><div class="container">${sectionHead('Kampens hendelser', 'Utvisninger')}
      <div class="panel table-scroll"><table class="league-table"><thead><tr><th>Periode</th><th>Tid</th><th>Lag</th><th>Spiller</th><th>Årsak</th><th>Min</th></tr></thead><tbody>${penalties.map(p => `<tr><td>${e(p.period)}</td><td>${e(p.time)}</td><td>${e(getTeam(p.teamId)?.name || '')}</td><td>${e(fmtPlayer(p.playerId))}</td><td>${e(p.reason)}</td><td>${e(p.minutes)}</td></tr>`).join('')}</tbody></table></div>
      </div></section>`);
  }

  function teamMatchHistory(teamId) {
    const matches = sortMatches(state.matches.filter(match => match.home === teamId || match.away === teamId));
    if (!matches.length) return `<div class="empty">Ingen kamper registrert for dette laget.</div>`;
    return `<div class="match-history">${matches.map(match => {
      const opponent = getTeam(match.home === teamId ? match.away : match.home);
      const isHome = match.home === teamId;
      const gf = isHome ? match.homeGoals : match.awayGoals;
      const ga = isHome ? match.awayGoals : match.homeGoals;
      const goalEvents = (match.goalEvents || []).filter(goal => goal.teamId === teamId).length;
      return `
        <article class="history-card">
          <div>
            <strong>${isHome ? 'Hjemme' : 'Borte'} mot ${e(opponent ? opponent.name : 'Ukjent')}</strong>
            <small>${e(match.label || 'Seriekamp')} · ${e(formatDate(match.date))}</small>
          </div>
          <div class="history-score">${gf}-${ga}</div>
          <div class="history-extra">${goalEvents} scoringer registrert</div>
        </article>
      `;
    }).join('')}</div>`;
  }

  function teamPage(teamId) {
    const team = getTeam(teamId);
    if (!team) {
      renderPage('Lag ikke funnet', pageBanner('Feil', 'Lag ikke funnet', 'Det forespurte laget finnes ikke i datasettet.'));
      return;
    }

    const summary = summarize();
    const roster = summary.players.filter(player => player.teamId === teamId)
      .sort((a, b) => Number(a.number) - Number(b.number) || a.name.localeCompare(b.name));
    const record = summary.standings.find(row => row.team.id === teamId) || { gp: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 };
    const captain = team.captainId ? roster.find(player => player.id === team.captainId) : null;

    renderPage(`${team.name}`, `
      ${pageBanner('Lagside', team.name, team.description)}
      <section class="section">
        <div class="container">
          <a class="back-link" href="#/teams">← Til lagoversikten</a>
          <div class="team-overview" style="${teamStyle(team)}">
            <div class="team-badge large">${e(team.initials)}</div>
            <div>
              <div class="eyebrow">Hjemmebane · ${e(team.venue || team.city)}</div>
              <h2>${e(team.name)}</h2>
              <p>${e(team.description)}</p>
            </div>
          </div>
        </div>
      </section>
      <section class="section alt">
        <div class="container two-col">
          <article class="feature-card">
            <div class="eyebrow">Kaptein</div>
            <h3>${captain ? e(captain.name) : 'Kaptein ikke registrert ennå'}</h3>
            <p>${captain ? `Draktnummer #${e(captain.number)}. Oppdater lagsiden når kapteinen er bekreftet.` : 'Når dere vet hvem som er kaptein, kan det legges inn fra admin-siden ved å redigere datafilen eller via senere versjon med mer avansert administrasjon.'}</p>
          </article>
          <article class="feature-card">
            <div class="eyebrow">Sesongstatus</div>
            <div class="team-metrics">
              <div><strong>${record.pts}</strong><span>Poeng</span></div>
              <div><strong>${record.gp}</strong><span>Kamper</span></div>
              <div><strong>${record.gf}</strong><span>Mål for</span></div>
              <div><strong>${record.ga}</strong><span>Mål mot</span></div>
            </div>
          </article>
        </div>
      </section>
      <section class="section">
        <div class="container two-col team-layout">
          <div>
            ${sectionHead('Spillerstall', 'Registrerte spillere')}
            ${fullStatsTable(roster)}
          </div>
          <div>
            ${sectionHead('Kamper', 'Laghistorikk')}
            ${teamMatchHistory(teamId)}
          </div>
        </div>
      </section>
    `);
  }

  function homePage() {
    const summary = summarize();
    const totalGoals = state.matches.reduce((sum, match) => sum + Number(match.homeGoals || 0) + Number(match.awayGoals || 0), 0);
    renderPage('Forside', `
      <section class="hero">
        <div class="hero-overlay"></div>
        <div class="container hero-content">
          <div class="eyebrow">Sesongen ${e(state.season)}</div>
          <h1>MHL</h1>
          <p>${e(state.intro)}</p>
          <div class="actions">
            <a class="btn" href="#/table">Se tabellen</a>
            <a class="btn secondary" href="#/stats">Se statistikk</a>
          </div>
        </div>
      </section>
      <section class="photo-section"><div class="container"><div class="photo-intro"><span class="eyebrow">Ansiktene bak hockeyen</span><h2>FOLKA. ISEN. FELLESSKAPET.</h2><a href="#/rules" class="text-link">Les om ligaen og reglene →</a></div><div class="photo-mosaic">${galleryMarkup()}</div></div></section>
      <section class="section event-promo-section"><div class="container"><a class="event-promo" href="#/events"><div><div class="eyebrow">Upcoming Events · April 2027</div><h2>MHL VÅRCUP</h2><p>Til våren ønsker vi å samle MHL-lagene og invitere to utfordrere fra andre regioner. Følg planleggingen.</p></div><span class="event-promo-arrow">↗</span></a></div></section>
      <section class="section statement-strip">
        <div class="container statement-grid">
          <div class="statement-card"><strong>${state.teams.length}</strong><span>Lag registrert</span></div>
          <div class="statement-card"><strong>${state.matches.length}</strong><span>Kamper registrert</span></div>
          <div class="statement-card"><strong>${summary.players.length}</strong><span>Spillere registrert</span></div>
          <div class="statement-card"><strong>${totalGoals}</strong><span>Mål totalt</span></div>
        </div>
      </section>
      <section class="section">
        <div class="container">
          ${sectionHead('MHL', 'Verdigrunnlag')}
          <p class="section-intro">${e(state.about)}</p>
          ${valuesGrid()}
        </div>
      </section>
      <section class="section alt">
        <div class="container">
          ${sectionHead('Nyheter', 'Publiseringer')}
          ${postsMarkup(summary.posts.slice(0, 4))}
        </div>
      </section>
      <section class="section">
        <div class="container">
          ${sectionHead('Lagene', 'Møt MHL-lagene', '#/teams', 'Alle lagsider')}
          <div class="team-grid">${state.teams.map(teamCard).join('')}</div>
        </div>
      </section>
      <section class="section alt">
        <div class="container two-col">
          <div>
            ${sectionHead('Oversikt', 'League Table', '#/table', 'Hele tabellen')}
            ${standingsTable(summary.standings)}
          </div>
          <div>
            ${sectionHead('Resultater', 'Siste kamper')}
            ${resultsList(summary.matches.slice(0, 4))}
          </div>
        </div>
      </section>
      <section class="section">
        <div class="container">
          ${sectionHead('Topper ligaen', 'League leaders', '#/stats', 'Full statistikk')}
          ${leadersGrid(summary.leaders)}
        </div>
      </section>
    `);
  }

  function tablePage() {
    const summary = summarize();
    renderPage('League Table', `
      ${pageBanner('Ligaoversikt', 'League Table', 'Poengtabellen regnes automatisk ut fra kampene som er registrert i systemet.')}
      <section class="section">
        <div class="container">
          ${standingsTable(summary.standings)}
        </div>
      </section>
    `);
  }

  function statsPage() {
    const summary = summarize();
    renderPage('League Stats', `
      ${pageBanner('Statistikk', 'League Stats', 'Topplister og full spilleroversikt for mål, assists, målpoeng, utvisningsminutter og shutouts.')}
      <section class="section">
        <div class="container">
          ${leadersGrid(summary.leaders)}
        </div>
      </section>
      <section class="section alt">
        <div class="container">
          ${sectionHead('Alle registrerte spillere', 'Full spillerstatistikk')}
          ${fullStatsTable(summary.players)}
        </div>
      </section>
    `);
  }

  function fixtureMatch(fixtureId) {
    return state.matches.find(m => m.fixtureId === fixtureId) || null;
  }

  function fixturesPage() {
    const fixtures=(state.fixtures||[]).slice().sort((a,b)=>a.date.localeCompare(b.date)||a.time.localeCompare(b.time));
    const dates=[...new Set(fixtures.map(f=>f.date))];
    const completed = fixtures.filter(f => !!fixtureMatch(f.id)).length;
    renderPage('Terminliste', `
      ${pageBanner('Sesong 2026 / 2027', 'Terminliste & resultater', 'Terminliste og kampresultater på ett sted. Resultater registrert i admin oppdaterer automatisk poengtabell og terminliste.')}
      <section class="section"><div class="container">
        <div class="fixture-toolbar"><div><div class="eyebrow">Sesongen</div><h2>${fixtures.length} KAMPER · ${completed} MED RESULTAT</h2></div><label class="fixture-filter-label">Vis lag <select id="fixture-filter"><option value="">Alle lag</option>${state.teams.map(t=>`<option value="${e(t.id)}">${e(t.name)}</option>`).join('')}</select></label></div>
        <div id="fixture-list">${dates.map(date=>{const day=fixtures.filter(f=>f.date===date);return `<section class="fixture-day" data-date="${e(date)}"><div class="fixture-day-head"><strong>${e(new Date(date+'T12:00:00').toLocaleDateString('nb-NO',{weekday:'long',day:'numeric',month:'long',year:'numeric'}))}</strong><span>${day.length} kamper</span></div><div class="fixture-day-matches">${day.map(f=>{const m=fixtureMatch(f.id);return `<article class="fixture-match" data-home="${e(f.home)}" data-away="${e(f.away)}"><span class="fixture-time">${e(f.time)}</span><div class="fixture-opponents"><a href="#/team/${e(f.home)}">${e(getTeam(f.home)?.short||f.home)}</a><span class="fixture-versus">${m ? `${e(m.homeGoals)} – ${e(m.awayGoals)}` : 'VS'}</span><a href="#/team/${e(f.away)}">${e(getTeam(f.away)?.short||f.away)}</a></div><div class="fixture-venue"><span>⌖</span> ${e(f.venue)}</div>${m ? `<a class="fixture-result-link" href="#/match/${e(m.id)}">Kamprapport ↗</a>` : `<span class="fixture-upcoming">Ikke spilt / resultat mangler</span>`}</article>`}).join('')}</div></section>`}).join('')}</div>
        <p class="fixture-note">Resultat vises når en terminfestet kamp er registrert i admin. Historiske kampdata uten sikker kobling til terminlisten er beholdt som egne kamper, for å unngå å gjette hvilken kamp de tilhører.</p>
      </div></section>
    `);
  }

  function eventsPage() {
    renderPage('Upcoming Events', `
      ${pageBanner('Fellesskap på og utenfor isen', 'Upcoming Events', 'Cuper, samlinger og aktiviteter i MHL-miljøet.')}
      <section class="section"><div class="container"><div class="event-grid">
      ${(state.events || []).map(ev=>`<article class="event-feature"><div class="event-slab"><span>ARRANGEMENT</span><strong>${e(ev.month)}</strong><small>${e(ev.status)}</small></div><div class="event-details"><div class="eyebrow">${e(ev.status)}</div><h2>${e(ev.title)}</h2><p>${e(ev.description)}</p><p class="event-sub"><strong>Sted og tidspunkt:</strong> ${e(ev.venue)}</p><p class="event-sub">${e(ev.history)}</p><a class="text-link" href="#/teams">Se lagene →</a></div></article>`).join('')}
      </div></div></section>
    `);
  }

  function rulesPage() {
    renderPage('Om ligaen og regler', `
      ${pageBanner('MHL / Spilleberettigelse', 'Hockey for alle – på riktig nivå', 'MHL er en liga for nye og tilbakevendende hockeyspillere. Her er rammene som gjør det trygt og rettferdig å delta.')}
      <section class="section"><div class="container rules-layout">
        <div><div class="eyebrow">Dette er MHL</div><h2 class="rules-title">EN INNGANG TIL ISHOCKEYEN.</h2><p class="rules-lead">Ikke alle ønsker eller trenger prestasjonskravene fra divisjonshockey. I MHL kan voksne nybegynnere og re-begynnere oppleve kamper, lagfølelse og mestring i sitt eget tempo.</p><div class="rules-image"><img src="assets/hockey-4.jpg" alt="Hockeyspillere sammen på isen"></div></div>
        <div class="rules-list">${(state.rules || []).map((r,i)=>`<article class="rules-item"><span>0${i+1}</span><div><h3>${e(r.title)}</h3><p>${e(r.body)}</p></div></article>`).join('')}</div>
      </div></section>
      <section class="section alt"><div class="container"><div class="rules-cta"><div class="eyebrow">Spilt på høyere nivå?</div><h2>Hockeyen har plass til deg også.</h2><p>Har du spilt i 3. divisjon eller høyere, kontakt ishockeykretsen for å finne et passende 4.-divisjonslag eller oldboyslag.</p></div></div></section>
    `);
  }

  function teamsPage() {
    renderPage('Lagene', `
      ${pageBanner('Lagoversikt', 'MHL-lagene', 'Hvert lag får sin egen side med grunninformasjon, spillerstall, kaptein og sesongutvikling.')}
      <section class="section">
        <div class="container">
          <div class="team-grid">${state.teams.map(teamCard).join('')}</div>
        </div>
      </section>
    `);
  }

  function teamOptions(selected) {
    return state.teams.map(team => `<option value="${e(team.id)}" ${team.id === selected ? 'selected' : ''}>${e(team.name)}</option>`).join('');
  }

  function goalRow(index) {
    return `
      <div class="repeat-row goal-row">
        <select name="goalTeam" aria-label="Lag">${teamOptions('ozo')}</select>
        <input name="goalPlayer" type="number" min="0" placeholder="Scorer #" aria-label="Målscorer nummer">
        <input name="goalAssists" type="text" placeholder="Assist (f.eks. 15,28)" aria-label="Assistnumre">
        <input name="goalPeriod" type="number" min="1" max="3" value="1" aria-label="Periode">
        <input name="goalTime" type="text" placeholder="MM:SS" aria-label="Tid">
        <button type="button" class="ghost-btn" data-action="remove-row">Fjern</button>
      </div>
    `;
  }

  function penaltyRow(index) {
    return `
      <div class="repeat-row penalty-row">
        <select name="penaltyTeam" aria-label="Lag">${teamOptions('ozo')}</select>
        <input name="penaltyPlayer" type="number" min="0" placeholder="Spiller #" aria-label="Spiller nummer">
        <input name="penaltyReason" type="text" placeholder="Årsak" aria-label="Årsak">
        <input name="penaltyMinutes" type="number" min="0" value="2" aria-label="Minutter">
        <input name="penaltyPeriod" type="number" min="1" max="3" value="1" aria-label="Periode">
        <input name="penaltyTime" type="text" placeholder="MM:SS" aria-label="Tid">
        <button type="button" class="ghost-btn" data-action="remove-row">Fjern</button>
      </div>
    `;
  }

  function adminPage() {
    const summary = summarize();
    const loggedIn = isLoggedIn();
    renderPage('Admin', `
      ${pageBanner('Administrasjon', 'Admin', 'MHL administreres med sikker serverinnlogging. Endringer lagres i Cloudflare D1 og publiseres for alle besøkende.')}
      <section class="section">
        <div class="container admin-grid">
          ${loggedIn ? `
            <article class="panel admin-panel admin-wide">
              <div class="panel-header"><h3>Ny kamp</h3></div>
              <form id="fixture-form" class="stack-form">
                <p class="form-hint">Legg til en kamp i terminlisten. Du kan også legge til kamper som allerede er spilt, og registrere resultatet etterpå.</p>
                <div class="field-grid two">
                  <label>Hjemmelag<select name="home" required><option value="">Velg hjemmelag</option>${teamOptions('')}</select></label>
                  <label>Bortelag<select name="away" required><option value="">Velg bortelag</option>${teamOptions('')}</select></label>
                </div>
                <div class="field-grid two">
                  <label>Dato<input type="date" name="date" required></label>
                  <label>Klokkeslett<input type="time" name="time" required></label>
                </div>
                <div class="field-grid two">
                  <label>Hall<input type="text" name="venue" maxlength="120" required placeholder="F.eks. Leangen ungdomshall"></label>
                  <label>Runde (valgfritt)<input type="number" name="round" min="1" max="999" step="1"></label>
                </div>
                <p id="fixture-status" class="form-hint" role="status" aria-live="polite"></p>
                <button class="btn" type="submit">Opprett kamp</button>
              </form>
            </article>
            ${(state.matches||[]).some(m=>!m.fixtureId) ? `
            <article class="panel admin-panel admin-wide">
              <div class="panel-header"><h3>Koble eksisterende kamprapport</h3></div>
              <form id="link-match-form" class="stack-form">
                <p class="form-hint">Disse kamprapportene er ikke koblet til terminlisten. Koble rapporten til riktig kamp før du registrerer resultatet på nytt. Mål og utvisninger beholdes.</p>
                <label>Eksisterende rapport<select name="matchId" required><option value="">Velg rapport</option>${state.matches.filter(m=>!m.fixtureId).map(m=>`<option value="${e(m.id)}">${e(getTeam(m.home)?.name)} ${e(m.homeGoals)}–${e(m.awayGoals)} ${e(getTeam(m.away)?.name)} · ${e(formatDate(m.date))} · ${e(m.label)} · ${(m.goalEvents||[]).length} scoringer, ${(m.penalties||[]).length} utvisninger</option>`).join('')}</select></label>
                <label>Kamp i terminlisten<select name="fixtureId" required><option value="">Velg rapport først</option></select></label>
                <p class="form-hint">Velg riktig dato. Finnes allerede en rapport på kampen, slås oppføringene sammen bare når resultat og hendelser er forenlige.</p>
                <p id="link-status" class="form-hint" role="status" aria-live="polite"></p>
                <button class="btn" type="submit">Koble rapport til kamp</button>
              </form>
            </article>` : ''}
            ${adminGalleryMarkup()}
            <article class="panel admin-panel">
              <div class="panel-header"><h3>Ny publisering</h3></div>
              <form id="post-form" class="stack-form">
                <label>Tittel<input type="text" name="title" required></label>
                <label>Forfatter<input type="text" name="author" value="Ligaadmin" required></label>
                <label>Innhold<textarea name="content" rows="5" required></textarea></label>
                <label class="checkbox"><input type="checkbox" name="pinned"> Fest innlegget øverst</label>
                <button class="btn" type="submit">Publiser innlegg</button>
              </form>
            </article>
            <article class="panel admin-panel admin-wide">
              <div class="panel-header"><h3>Registrer kampstatistikk</h3></div>
              <form id="match-form" class="stack-form">
                <label>Velg terminfestet kamp (redigerer resultatet om det allerede er registrert)
                  <select name="fixtureId" id="admin-fixture-select" required>
                    <option value="">Velg kamp fra terminlisten</option>
                    ${(state.fixtures||[]).slice().sort((a,b)=>a.date.localeCompare(b.date)||a.time.localeCompare(b.time)).map(f=>{const recorded=fixtureMatch(f.id);return `<option value="${e(f.id)}">${e(formatDate(f.date))} ${e(f.time)} · ${e(getTeam(f.home)?.name)} – ${e(getTeam(f.away)?.name)} ${recorded ? `· ${recorded.homeGoals}–${recorded.awayGoals}` : ''}</option>`}).join('')}
                  </select>
                </label>
                <p id="match-existing-hint" class="form-hint">Velg kampen fra terminlisten før du registrerer resultatet.</p>
                <div class="field-grid two">
                  <label>Kampnavn<input type="text" name="label" placeholder="F.eks. Runde 3" required></label>
                  <label>Dato<input type="date" name="date"></label>
                </div>
                <div class="field-grid two">
                  <label>Hjemmelag<select name="home" required>${teamOptions(state.teams[0]?.id)}</select></label>
                  <label>Bortelag<select name="away" required>${teamOptions(state.teams[1]?.id)}</select></label>
                </div>
                <div class="field-grid two">
                  <label>Hjemmemål<input type="number" name="homeGoals" min="0" required></label>
                  <label>Bortemål<input type="number" name="awayGoals" min="0" required></label>
                </div>

                <div class="subsection-head">
                  <h4>Scoringer</h4>
                  <button class="ghost-btn" type="button" data-action="add-goal-row">+ Legg til scoring</button>
                </div>
                <div id="goal-rows" class="repeat-wrap">${goalRow(0)}</div>
                <small class="form-hint">Når et draktnummer ikke finnes fra før, opprettes spilleren automatisk på valgt lag.</small>

                <div class="subsection-head">
                  <h4>Utvisninger</h4>
                  <button class="ghost-btn" type="button" data-action="add-penalty-row">+ Legg til utvisning</button>
                </div>
                <div id="penalty-rows" class="repeat-wrap">${penaltyRow(0)}</div>

                <button class="btn" type="submit">Lagre kamp</button>
              </form>
            </article>
            <article class="panel admin-panel">
              <div class="panel-header"><h3>Spiller og kaptein</h3></div>
              <form id="player-form" class="stack-form">
                <label>Lag<select name="teamId" required>${teamOptions(state.teams[0]?.id)}</select></label>
                <label>Draktnummer<input type="number" name="number" min="0" required></label>
                <label>Spillernavn<input type="text" name="name" placeholder="Fornavn Etternavn" required></label>
                <label>Posisjon<select name="position"><option value="F">Løper</option><option value="D">Back</option><option value="GK">Målvakt</option></select></label>
                <label>Shutouts (målvakt)<input type="number" name="shutouts" min="0" value="0"></label>
                <label class="checkbox"><input type="checkbox" name="captain"> Sett som lagkaptein</label>
                <button class="btn" type="submit">Lagre spiller</button>
              </form>
              <p class="admin-note">Samme lag og draktnummer oppdaterer eksisterende spiller. Keeperens shutouts registreres manuelt.</p>
            </article>
            <article class="panel admin-panel">
              <div class="panel-header"><h3>Dataverktøy</h3></div>
              <div class="admin-actions">
                <button class="btn secondary" type="button" data-action="export-data">Eksporter JSON</button>
                <label class="file-upload">Importer JSON<input type="file" id="import-json" accept="application/json"></label>
                
                <button class="btn secondary" type="button" data-action="logout">Logg ut</button>
              </div>
              <p class="admin-note">Endringer lagres i Cloudflare D1 og blir synlige for alle. Eksporter gjerne sikkerhetskopi før større endringer.</p>
            </article>
            <article class="panel admin-panel admin-wide">
              <div class="panel-header"><h3>Publiseringer</h3></div>
              <div class="admin-list">
                ${summary.posts.map(post => `
                  <div class="admin-list-item">
                    <div>
                      <strong>${e(post.title)}</strong>
                      <small>${e(post.author || 'MHL')} · ${e(formatDate((post.createdAt || '').slice(0, 10)))}</small>
                    </div>
                    <button class="ghost-btn" type="button" data-action="delete-post" data-post-id="${e(post.id)}">Slett</button>
                  </div>
                `).join('')}
              </div>
            </article>
          ` : `
            <article class="panel admin-panel single-column">
              <div class="panel-header"><h3>Logg inn</h3></div>
              <form id="login-form" class="stack-form">
                <label>Brukernavn<input type="text" name="username" required></label>
                <label>Passord<input type="password" name="password" required></label>
                <button class="btn" type="submit">Logg inn</button>
              </form>
              <p class="admin-note">Innloggingen håndteres på serveren. Bruk adminbrukernavn og passord satt som Cloudflare-secrets.</p>
            </article>
          `}
        </div>
      </section>
    `);
  }

  function renderPage(title, html) {
    document.title = `${title} | ${state.leagueName}`;
    footerSeason.textContent = state.season;
    app.innerHTML = html;
    document.querySelectorAll('[data-nav]').forEach(link => {
      const segment = (location.hash.replace(/^#\/?/, '').split('/')[0] || '');
      const activeKey = segment === '' ? 'home' : segment;
      link.classList.toggle('active', link.dataset.nav === activeKey);
    });
    window.scrollTo(0, 0);
  }

  function route() {
    const hash = location.hash.replace(/^#\/?/, '');
    const [segment, subsegment] = hash.split('/');
    if (!segment) {
      homePage();
      return;
    }
    if (segment === 'table') return tablePage();
    if (segment === 'stats') return statsPage();
    if (segment === 'teams') return teamsPage();
    if (segment === 'rules') return rulesPage();
    if (segment === 'fixtures') return fixturesPage();
    if (segment === 'events') return eventsPage();
    if (segment === 'team') return teamPage(decodeURIComponent(subsegment || ''));
    if (segment === 'match') return matchPage(decodeURIComponent(subsegment || ''));
    if (segment === 'admin') return adminPage();
    renderPage('Ikke funnet', pageBanner('404', 'Siden finnes ikke', 'Lenken du åpnet peker ikke til en registrert side i MHL-løsningen.'));
  }

  document.addEventListener('submit', async event => {
    const form = event.target;

    if (form.id === 'login-form') {
      event.preventDefault();
      const data = new FormData(form);
      try {
        await fetchJSON('/api/login', {method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({username:String(data.get('username')||'').trim(),password:String(data.get('password')||'')})});
        setLoggedIn(true);route();
      } catch(err) { alert('Innlogging mislyktes: '+err.message); }
      return;
    }

    if (form.id === 'fixture-form') {
      event.preventDefault();
      if (saving) return;
      const data = new FormData(form);
      const input = Object.fromEntries(['home','away','date','time','venue','round'].map(key => [key,String(data.get(key)||'').trim()]));
      const status = form.querySelector('#fixture-status');
      if (!input.home || !input.away || input.home === input.away) {
        status.textContent = 'Velg to ulike lag.'; return;
      }
      const button = form.querySelector('button[type="submit"]');
      saving = true; button.disabled = true; status.textContent = 'Lagrer kampen …';
      try {
        const result = await fetchJSON('/api/fixtures', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...input,revision})});
        state = result.data; revision = result.revision;
        route();
        const select = document.getElementById('admin-fixture-select');
        select.value = result.fixture.id;
        select.dispatchEvent(new Event('change',{bubbles:true}));
        document.getElementById('fixture-status').textContent = 'Kampen er opprettet og vises i terminlisten. Du kan registrere resultatet nedenfor nå eller senere.';
        document.getElementById('match-form').scrollIntoView({behavior:'smooth',block:'start'});
        select.focus({preventScroll:true});
      } catch (error) {
        status.textContent = 'Kampen ble ikke opprettet: ' + error.message;
      } finally { saving = false; button.disabled = false; }
      return;
    }

    if (form.id === 'link-match-form') {
      event.preventDefault();
      if (saving) return;
      const data = new FormData(form);
      const matchId = String(data.get('matchId')||'');
      const fixtureId = String(data.get('fixtureId')||'');
      const match = state.matches.find(m=>m.id===matchId);
      const fixture = state.fixtures.find(f=>f.id===fixtureId);
      if (!match || !fixture) return;
      if (!confirm(`Koble ${getTeam(match.home)?.name} ${match.homeGoals}–${match.awayGoals} ${getTeam(match.away)?.name} til kampen ${formatDate(fixture.date)} kl. ${fixture.time}? Eventuell dobbeltføring slås sammen, og hendelsene beholdes.`)) return;
      saving = true;
      const button = form.querySelector('button[type="submit"]'); button.disabled = true;
      const status = form.querySelector('#link-status'); status.textContent = 'Kobler rapporten …';
      try {
        const result = await fetchJSON('/api/link-match',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision,matchId,fixtureId})});
        state = result.data; revision = result.revision; route();
        alert('Rapporten er koblet til terminlisten. Kampen telles én gang.');
      } catch(error) { status.textContent = 'Kobling mislyktes: '+error.message; }
      finally { saving = false; button.disabled = false; }
      return;
    }

    if (form.id === 'post-form') {
      event.preventDefault();
      const data = new FormData(form);
      state.posts.unshift({
        id: `post-${Date.now().toString(36)}`,
        title: String(data.get('title') || '').trim(),
        author: String(data.get('author') || '').trim(),
        content: String(data.get('content') || '').trim(),
        pinned: data.get('pinned') === 'on',
        createdAt: new Date().toISOString()
      });
      await saveData();
      route();
      return;
    }

    if (form.id === 'player-form') {
      event.preventDefault();
      const data = new FormData(form);
      const teamId = String(data.get('teamId') || '');
      const number = Number(data.get('number'));
      const name = String(data.get('name') || '').trim();
      if (!getTeam(teamId) || !Number.isFinite(number) || !name) return;
      const id = ensurePlayer(teamId, number);
      const player = getPlayer(id);
      player.name = name;
      player.position = String(data.get('position') || 'F');
      player.shutouts = Number(data.get('shutouts') || 0);
      if (data.get('captain') === 'on') getTeam(teamId).captainId = id;
      await saveData(); route(); return;
    }

    if (form.id === 'match-form') {
      event.preventDefault();
      const data = new FormData(form);
      const fixtureId=String(data.get('fixtureId')||'');
      const fixture=(state.fixtures||[]).find(f=>f.id===fixtureId);
      if(!fixture){alert('Velg en kamp fra terminlisten.');return;}
      const unlinked = state.matches.filter(m=>!m.fixtureId && (!m.date || m.date===fixture.date) && ((m.home===fixture.home&&m.away===fixture.away)||(m.home===fixture.away&&m.away===fixture.home)));
      if (unlinked.length && !confirm('Det finnes en eldre kamprapport mellom disse lagene som ikke er koblet til terminlisten. Er dette en annen kamp? Velg Avbryt og bruk «Koble eksisterende kamprapport» hvis det er samme kamp.')) return;
      const home = fixture.home;
      const away = fixture.away;
      if (!home || !away || home === away) {
        alert('Velg to ulike lag i kampen.');
        return;
      }

      const goalEvents = [];
      form.querySelectorAll('.goal-row').forEach(row => {
        const teamId = row.querySelector('[name="goalTeam"]').value;
        const scorerNumber = row.querySelector('[name="goalPlayer"]').value;
        const time = row.querySelector('[name="goalTime"]').value.trim();
        if (!teamId || !scorerNumber || !time) return;
        const scorerPlayerId = ensurePlayer(teamId, scorerNumber);
        const assists = row.querySelector('[name="goalAssists"]').value
          .split(',')
          .map(item => item.trim())
          .filter(Boolean)
          .map(number => ensurePlayer(teamId, number))
          .filter(Boolean);
        goalEvents.push({
          teamId,
          period: Number(row.querySelector('[name="goalPeriod"]').value || 1),
          time,
          scorerPlayerId,
          assistPlayerIds: assists
        });
      });

      const penalties = [];
      form.querySelectorAll('.penalty-row').forEach(row => {
        const teamId = row.querySelector('[name="penaltyTeam"]').value;
        const playerNumber = row.querySelector('[name="penaltyPlayer"]').value;
        const reason = row.querySelector('[name="penaltyReason"]').value.trim();
        const time = row.querySelector('[name="penaltyTime"]').value.trim();
        if (!teamId || !playerNumber || !reason || !time) return;
        penalties.push({
          teamId,
          playerId: ensurePlayer(teamId, playerNumber),
          period: Number(row.querySelector('[name="penaltyPeriod"]').value || 1),
          time,
          reason,
          minutes: Number(row.querySelector('[name="penaltyMinutes"]').value || 2)
        });
      });

      const old=fixtureMatch(fixtureId);
      const updated={
        id: old?.id || `match-${Date.now().toString(36)}`,
        fixtureId,
        label: String(data.get('label') || '').trim() || (fixture.round ? `Runde ${fixture.round}` : 'Ligakamp'),
        date: fixture.date,
        home,
        away,
        homeGoals: Number(data.get('homeGoals')),
        awayGoals: Number(data.get('awayGoals')),
        goalEvents: goalEvents.length ? goalEvents : (old?.goalEvents || []),
        penalties: penalties.length ? penalties : (old?.penalties || [])
      };
      if(old) state.matches=state.matches.map(m=>m.id===old.id?updated:m);
      else state.matches.unshift(updated);

      await saveData();
      route();
      return;
    }
  });

  document.addEventListener('change', event => {
    if(event.target.name==='matchId' && event.target.closest('#link-match-form')) {
      const form=event.target.closest('form');
      const match=state.matches.find(m=>m.id===event.target.value);
      const fixtures=match ? state.fixtures.filter(f=>(f.home===match.home&&f.away===match.away)||(f.home===match.away&&f.away===match.home)) : [];
      form.querySelector('[name="fixtureId"]').innerHTML='<option value="">Velg riktig kamp og dato</option>'+fixtures.slice().sort((a,b)=>a.date.localeCompare(b.date)||a.time.localeCompare(b.time)).map(f=>`<option value="${e(f.id)}">${e(formatDate(f.date))} ${e(f.time)} · ${e(getTeam(f.home)?.name)} – ${e(getTeam(f.away)?.name)} · ${e(f.venue)}</option>`).join('');
      return;
    }
    if(event.target.id==='admin-fixture-select') {
      const f=(state.fixtures||[]).find(x=>x.id===event.target.value);
      const form=document.getElementById('match-form');
      if(!f||!form) return;
      const old=fixtureMatch(f.id);
      form.querySelector('[name="home"]').value=f.home;
      form.querySelector('[name="away"]').value=f.away;
      form.querySelector('[name="date"]').value=f.date;
      form.querySelector('[name="label"]').value=(f.round ? 'Runde '+f.round : 'Ligakamp')+' · '+f.venue;
      form.querySelector('[name="homeGoals"]').value=old?.homeGoals??'';
      form.querySelector('[name="awayGoals"]').value=old?.awayGoals??'';
      const alertBox=document.getElementById('match-existing-hint');
      if(alertBox)alertBox.textContent=old?'Eksisterende kamp: Lagre for å oppdatere (ikke opprette en duplikat). Tidligere hendelser beholdes dersom du ikke legger inn nye.':'Ny terminfestet kamp: Resultatet vil vises i tabell og terminliste.';
      return;
    }
    if(event.target.id!=='fixture-filter') return;
    const id=event.target.value;
    document.querySelectorAll('.fixture-day').forEach(day=>{
      let visible=0;
      day.querySelectorAll('.fixture-match').forEach(match=>{
        const show=!id||match.dataset.home===id||match.dataset.away===id;
        match.hidden=!show;if(show)visible++;
      });
      day.hidden=!visible;
      const n=day.querySelector('.fixture-day-head span');
      if(n)n.textContent=visible+' kamper';
    });
  });
  document.addEventListener('click', event => {
    const tile=event.target.closest('.photo-tile');
    const modal=document.getElementById('photo-lightbox');
    if(tile&&modal){const img=tile.querySelector('img');const big=modal.querySelector('img');big.src=img.src;big.alt=img.alt;modal.hidden=false;modal.querySelector('button').focus();return;}
    if(modal&&!modal.hidden&&(event.target===modal||event.target.closest('.photo-lightbox-close'))){modal.hidden=true;modal.querySelector('img').removeAttribute('src');}
  });
  document.addEventListener('keydown',event=>{if(event.key==='Escape'){const modal=document.getElementById('photo-lightbox');if(modal)modal.hidden=true;}});

  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const action = button.dataset.action;

    if (action === 'add-goal-row') {
      const wrap = document.getElementById('goal-rows');
      if (wrap) wrap.insertAdjacentHTML('beforeend', goalRow(wrap.children.length));
      return;
    }

    if (action === 'add-penalty-row') {
      const wrap = document.getElementById('penalty-rows');
      if (wrap) wrap.insertAdjacentHTML('beforeend', penaltyRow(wrap.children.length));
      return;
    }

    if (action === 'remove-row') {
      const row = button.closest('.repeat-row');
      if (row && row.parentElement.children.length > 1) row.remove();
      return;
    }

    if (action === 'logout') {
      try { await fetchJSON('/api/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}); } catch(err) { alert(err.message); }
      setLoggedIn(false);route();return;
    }

    if (action === 'delete-post') {
      const id = button.dataset.postId;
      state.posts = state.posts.filter(post => post.id !== id);
      await saveData();
      route();
      return;
    }

    if (action === 'reset-data') {
      if (confirm('Vil du nullstille alle lokale endringer og gå tilbake til standarddata?')) {
        resetData();
      }
      return;
    }

    if (action === 'export-data') {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `mhl-data-${slugify(state.season)}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      return;
    }
  });

  document.addEventListener('change', event => {
    const input = event.target;
    if (input.id === 'import-json' && input.files && input.files[0]) {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const parsed = JSON.parse(String(reader.result || '{}'));
          if (!parsed.teams || !parsed.players || !parsed.matches) throw new Error('Ugyldig datastruktur');
          state = parsed;
          await saveData();
          route();
        } catch (err) {
          alert('Kunne ikke importere JSON-filen. Kontroller formatet og prøv igjen.');
        }
      };
      reader.readAsText(input.files[0]);
    }
  });

  document.addEventListener('submit',async event=>{
    if(event.target.id!=='photo-form')return;
    event.preventDefault();
    const form=event.target, fd=new FormData(form), file=fd.get('photo');
    if(!(file instanceof File)||!file.size)return alert('Velg et bilde.');
    if(file.size>6*1024*1024)return alert('Bildet er over 6 MB.');
    const button=form.querySelector('button[type="submit"]');button.disabled=true;
    try{
      const response=await fetch('/api/photos',{method:'POST',body:fd,credentials:'same-origin'});
      const result=await response.json();if(!response.ok)throw Error(result.error||'Kunne ikke laste opp');
      await loadGallery();route();
    }catch(error){alert('Bildeopplasting feilet: '+error.message)}finally{button.disabled=false;}
  });
  document.addEventListener('click',async event=>{
    const toggle=event.target.closest('[data-photo-toggle]'),del=event.target.closest('[data-photo-delete]');
    if(!toggle&&!del)return;
    if(!isLoggedIn())return;
    if(del&&!confirm('Slette dette bildet permanent?'))return;
    const el=toggle||del, id=el.dataset.photoToggle||el.dataset.photoDelete;
    try {await fetchJSON('/api/photos/'+encodeURIComponent(id),{
      method:del?'DELETE':'PATCH',headers:{'Content-Type':'application/json'},
      body:del?'{}':JSON.stringify({active:toggle.dataset.active==='1'})
    });await loadGallery();route();}
    catch(error){alert(error.message);}
  });

  window.addEventListener('hashchange', route);

  const menuToggle = document.getElementById('menu-toggle');
  if (menuToggle) {
    menuToggle.addEventListener('click', () => {
      const nav = document.querySelector('.site-header nav');
      const willOpen = !nav.classList.contains('open');
      nav.classList.toggle('open', willOpen);
      menuToggle.setAttribute('aria-expanded', String(willOpen));
    });
  }

  document.addEventListener('click', event => {
    const nav = document.querySelector('.site-header nav');
    if (!nav) return;
    if (event.target.closest('.site-header nav a')) {
      nav.classList.remove('open');
      menuToggle?.setAttribute('aria-expanded', 'false');
    }
  });

  app.innerHTML='<section class="section"><div class="container">Laster MHL fra databasen …</div></section>';
  loadRemoteData().catch(err=>{app.innerHTML='<section class="section"><div class="container"><h2>Kunne ikke hente ligadata</h2><p>Serveren er ikke ferdig satt opp, eller databasen er utilgjengelig. Kontroller Pages Functions, D1-binding og migrering.</p></div></section>';console.error(err);});
})();
