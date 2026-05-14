// Worker-safe dashboard synthesizer.
// 保持输出结构与 jarvis.html 期望一致，但不读取本地 runs/，也不调用 child_process。

const cyrillic = /[\u0400-\u04FF]/;

const geoKeywords = {
  Ukraine: [49, 32],
  Russia: [56, 38],
  Moscow: [55.7, 37.6],
  Kyiv: [50.4, 30.5],
  China: [35, 105],
  Beijing: [39.9, 116.4],
  Iran: [32, 53],
  Tehran: [35.7, 51.4],
  Israel: [31.5, 35],
  Gaza: [31.4, 34.4],
  Palestine: [31.9, 35.2],
  Syria: [35, 38],
  Iraq: [33, 44],
  Saudi: [24, 45],
  Yemen: [15, 48],
  Lebanon: [34, 36],
  India: [20, 78],
  Japan: [36, 138],
  Korea: [37, 127],
  Taiwan: [23.5, 121],
  Philippines: [13, 122],
  Myanmar: [20, 96],
  Canada: [56, -96],
  Mexico: [23, -102],
  Brazil: [-14, -51],
  Argentina: [-38, -63],
  Colombia: [4, -74],
  Venezuela: [7, -66],
  Cuba: [22, -80],
  Chile: [-35, -71],
  Germany: [51, 10],
  France: [46, 2],
  UK: [54, -2],
  London: [51.5, -0.1],
  NATO: [50, 4],
  Turkey: [39, 35],
  Africa: [0, 20],
  Nigeria: [10, 8],
  Egypt: [27, 30],
  Sudan: [13, 30],
  Ethiopia: [9, 38],
  Somalia: [5, 46],
  Pakistan: [30, 70],
  Afghanistan: [33, 65],
  Australia: [-25, 134],
  Indonesia: [-2, 118],
  US: [39, -98],
  America: [39, -98],
  Washington: [38.9, -77],
  'Wall Street': [40.7, -74],
  'New York': [40.7, -74],
  Fed: [38.9, -77],
  Congress: [38.9, -77],
  Pentagon: [38.9, -77],
  UN: [40.7, -74],
};

function isEnglish(text) {
  return Boolean(text) && !cyrillic.test(text.substring(0, 80));
}

function geoTagText(text) {
  if (!text) return null;
  for (const [keyword, [lat, lon]] of Object.entries(geoKeywords)) {
    if (text.includes(keyword)) return { lat, lon, region: keyword };
  }
  return null;
}

function sanitizeExternalUrl(raw) {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function sumAirHotspots(hotspots = []) {
  return hotspots.reduce((sum, hotspot) => sum + (hotspot.totalAircraft || 0), 0);
}

function summarizeAirHotspots(hotspots = []) {
  return hotspots.map(hotspot => ({
    region: hotspot.region,
    total: hotspot.totalAircraft || 0,
    noCallsign: hotspot.noCallsign || 0,
    highAlt: hotspot.highAltitude || 0,
    top: Object.entries(hotspot.byCountry || {}).sort((a, b) => b[1] - a[1]).slice(0, 5),
  }));
}

async function fetchRSS(url, source) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const xml = await response.text();
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    while ((match = itemRegex.exec(xml)) !== null) {
      const block = match[1];
      const title = (block.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/)?.[1] || '').trim();
      const link = sanitizeExternalUrl((block.match(/<link>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/link>/)?.[1] || '').trim());
      const pubDate = block.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || '';
      if (title && title !== source) items.push({ title, date: pubDate, source, url: link });
    }
    return items;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchAllNews() {
  const feeds = [
    ['http://feeds.bbci.co.uk/news/world/rss.xml', 'BBC'],
    ['https://rss.nytimes.com/services/xml/rss/nyt/World.xml', 'NYT'],
    ['https://www.aljazeera.com/xml/rss/all.xml', 'Al Jazeera'],
    ['https://feeds.npr.org/1001/rss.xml', 'NPR'],
    ['https://feeds.bbci.co.uk/news/technology/rss.xml', 'BBC Tech'],
    ['https://www.france24.com/en/rss', 'France 24'],
    ['https://www.euronews.com/rss?format=mrss', 'Euronews'],
    ['https://rss.dw.com/rdf/rss-en-africa', 'DW Africa'],
    ['https://www.africanews.com/feed/rss', 'Africa News'],
    ['https://indianexpress.com/section/india/feed/', 'Indian Express'],
    ['https://en.mercopress.com/rss/latin-america', 'MercoPress'],
  ];

  const results = await Promise.allSettled(feeds.map(([url, source]) => fetchRSS(url, source)));
  const allNews = results.filter(result => result.status === 'fulfilled').flatMap(result => result.value);
  const seen = new Set();
  const geoNews = [];

  for (const item of allNews) {
    const key = item.title.substring(0, 48).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const geo = geoTagText(item.title);
    if (!geo) continue;
    geoNews.push({
      title: item.title.substring(0, 100),
      source: item.source,
      date: item.date,
      url: item.url,
      lat: geo.lat + (Math.random() - 0.5) * 2,
      lon: geo.lon + (Math.random() - 0.5) * 2,
      region: geo.region,
    });
  }

  geoNews.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  return geoNews.slice(0, 50);
}

function buildNewsFeed(rssNews, gdeltData, tgUrgent, tgTop) {
  const feed = [];
  for (const item of rssNews) {
    feed.push({
      headline: item.title,
      source: item.source,
      type: 'rss',
      timestamp: item.date,
      region: item.region,
      urgent: false,
      url: item.url,
    });
  }

  for (const article of (gdeltData.allArticles || []).slice(0, 10)) {
    if (!article.title) continue;
    const geo = geoTagText(article.title);
    feed.push({
      headline: article.title.substring(0, 100),
      source: 'GDELT',
      type: 'gdelt',
      timestamp: new Date().toISOString(),
      region: geo?.region || 'Global',
      urgent: false,
      url: sanitizeExternalUrl(article.url),
    });
  }

  for (const post of tgUrgent.slice(0, 10)) {
    feed.push({
      headline: (post.text || '').trim().substring(0, 100),
      source: post.channel?.toUpperCase() || 'TELEGRAM',
      type: 'telegram',
      timestamp: post.date,
      region: 'OSINT',
      urgent: true,
    });
  }

  for (const post of tgTop.slice(0, 5)) {
    feed.push({
      headline: (post.text || '').trim().substring(0, 100),
      source: post.channel?.toUpperCase() || 'TELEGRAM',
      type: 'telegram',
      timestamp: post.date,
      region: 'OSINT',
      urgent: false,
    });
  }

  feed.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
  return feed.slice(0, 50);
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

export async function synthesize(data) {
  const sources = data?.sources || {};
  const openSkyData = sources.OpenSky || {};
  const liveAirHotspots = safeArray(openSkyData.hotspots);
  const effectiveAirHotspots = liveAirHotspots;
  const air = summarizeAirHotspots(effectiveAirHotspots);

  const firmsData = sources.FIRMS || {};
  const thermal = safeArray(firmsData.hotspots).map(hotspot => ({
    region: hotspot.region,
    det: hotspot.totalDetections || 0,
    night: hotspot.nightDetections || 0,
    hc: hotspot.highConfidence || 0,
    fires: safeArray(hotspot.highIntensity).slice(0, 8).map(item => ({ lat: item.lat, lon: item.lon, frp: item.frp || 0 })),
  }));

  const sdrData = sources.KiwiSDR || {};
  const sdrConflict = sdrData.conflictZones || {};
  const sdrZones = Object.values(sdrConflict).map(zone => ({
    region: zone.region,
    count: zone.count || 0,
    receivers: safeArray(zone.receivers).slice(0, 5).map(receiver => ({
      name: receiver.name || '',
      lat: receiver.lat || 0,
      lon: receiver.lon || 0,
    })),
  }));

  const tgData = sources.Telegram || {};
  const tgUrgent = safeArray(tgData.urgentPosts).filter(post => isEnglish(post.text)).map(post => ({
    channel: post.channel || post.chat,
    text: post.text?.substring(0, 200),
    views: post.views,
    date: post.date,
    urgentFlags: post.urgentFlags || [],
    postId: post.postId || null,
  }));
  const tgTop = safeArray(tgData.topPosts).filter(post => isEnglish(post.text)).map(post => ({
    channel: post.channel || post.chat,
    text: post.text?.substring(0, 200),
    views: post.views,
    date: post.date,
    urgentFlags: [],
    postId: post.postId || null,
  }));

  const energyData = sources.EIA || {};
  const oilPrices = energyData.oilPrices || {};
  const wtiRecent = safeArray(oilPrices.wti?.recent).map(item => item.value);
  const yfData = sources.YFinance || {};
  const yfQuotes = yfData.quotes || {};
  const yfGold = yfQuotes['GC=F'];
  const yfSilver = yfQuotes['SI=F'];
  const yfWti = yfQuotes['CL=F'];
  const yfBrent = yfQuotes['BZ=F'];
  const yfNatgas = yfQuotes['NG=F'];

  const energy = {
    wti: yfWti?.price || oilPrices.wti?.value,
    brent: yfBrent?.price || oilPrices.brent?.value,
    natgas: yfNatgas?.price || energyData.gasPrice?.value,
    crudeStocks: energyData.inventories?.crudeStocks?.value,
    wtiRecent: yfWti?.history?.map(item => item.close) || wtiRecent,
    signals: energyData.signals || [],
  };

  const markets = {
    indexes: safeArray(yfData.indexes).map(q => ({ symbol: q.symbol, name: q.name, price: q.price, change: q.change, changePct: q.changePct, history: q.history || [] })),
    rates: safeArray(yfData.rates).map(q => ({ symbol: q.symbol, name: q.name, price: q.price, change: q.change, changePct: q.changePct })),
    commodities: safeArray(yfData.commodities).map(q => ({ symbol: q.symbol, name: q.name, price: q.price, change: q.change, changePct: q.changePct, history: q.history || [] })),
    crypto: safeArray(yfData.crypto).map(q => ({ symbol: q.symbol, name: q.name, price: q.price, change: q.change, changePct: q.changePct })),
    vix: yfQuotes['^VIX'] ? { value: yfQuotes['^VIX'].price, change: yfQuotes['^VIX'].change, changePct: yfQuotes['^VIX'].changePct } : null,
    timestamp: yfData.summary?.timestamp || null,
  };

  const metals = {
    gold: yfGold?.price,
    goldChange: yfGold?.change,
    goldChangePct: yfGold?.changePct,
    goldRecent: yfGold?.history?.map(item => item.close) || [],
    silver: yfSilver?.price,
    silverChange: yfSilver?.change,
    silverChangePct: yfSilver?.changePct,
    silverRecent: yfSilver?.history?.map(item => item.close) || [],
  };

  const acledData = sources.ACLED || {};
  const gdeltData = sources.GDELT || {};
  const spaceData = sources.Space || {};
  const news = await fetchAllNews();

  const V2 = {
    meta: data.crucix || { timestamp: new Date().toISOString(), sourcesQueried: 0, sourcesOk: 0, sourcesFailed: 0 },
    air,
    thermal,
    tSignals: firmsData.signals || [],
    chokepoints: Object.values(sources.Maritime?.chokepoints || {}).map(cp => ({
      label: cp.label || cp.name,
      note: cp.note || '',
      lat: cp.lat || 0,
      lon: cp.lon || 0,
    })),
    nuke: safeArray(sources.Safecast?.sites).map(site => ({
      site: site.site,
      anom: site.anomaly || false,
      cpm: site.avgCPM,
      n: site.recentReadings || 0,
    })),
    nukeSignals: safeArray(sources.Safecast?.signals).filter(Boolean),
    airMeta: {
      fallback: false,
      liveTotal: sumAirHotspots(liveAirHotspots),
      timestamp: openSkyData.timestamp || data.crucix?.timestamp || null,
      source: 'OpenSky',
      ...(openSkyData.error ? { error: openSkyData.error } : {}),
    },
    sdr: {
      total: sdrData.network?.totalReceivers || 0,
      online: sdrData.network?.online || 0,
      zones: sdrZones,
    },
    tg: { posts: tgData.totalPosts || 0, urgent: tgUrgent, topPosts: tgTop },
    who: safeArray(sources.WHO?.diseaseOutbreakNews).slice(0, 10).map(item => ({
      title: item.title?.substring(0, 120),
      date: item.date,
      summary: item.summary?.substring(0, 150),
    })),
    fred: safeArray(sources.FRED?.indicators).map(item => ({
      id: item.id,
      label: item.label,
      value: item.value,
      date: item.date,
      recent: item.recent || [],
      momChange: item.momChange,
      momChangePct: item.momChangePct,
    })),
    energy,
    metals,
    bls: sources.BLS?.indicators || [],
    treasury: {
      totalDebt: sources.Treasury?.debt?.[0]?.totalDebt || '0',
      signals: sources.Treasury?.signals || [],
    },
    gscpi: sources.GSCPI?.latest || null,
    defense: safeArray(sources.USAspending?.recentDefenseContracts).slice(0, 5).map(item => ({
      recipient: item.recipient?.substring(0, 40),
      amount: item.amount,
      desc: item.description?.substring(0, 80),
    })),
    noaa: {
      totalAlerts: sources.NOAA?.totalSevereAlerts || 0,
      alerts: safeArray(sources.NOAA?.topAlerts).filter(item => item.lat != null && item.lon != null).slice(0, 10).map(item => ({
        event: item.event,
        severity: item.severity,
        headline: item.headline?.substring(0, 120),
        lat: item.lat,
        lon: item.lon,
      })),
    },
    epa: {
      totalReadings: sources.EPA?.totalReadings || 0,
      stations: safeArray(sources.EPA?.readings).filter(item => item.lat != null && item.lon != null).slice(0, 10).map(item => ({
        location: item.location,
        state: item.state,
        lat: item.lat,
        lon: item.lon,
        analyte: item.analyte,
        result: item.result,
        unit: item.unit,
      })),
    },
    acled: acledData.error ? { totalEvents: 0, totalFatalities: 0, byRegion: {}, byType: {}, deadliestEvents: [] } : {
      totalEvents: acledData.totalEvents || 0,
      totalFatalities: acledData.totalFatalities || 0,
      byRegion: acledData.byRegion || {},
      byType: acledData.byType || {},
      deadliestEvents: safeArray(acledData.deadliestEvents).slice(0, 15).map(item => ({
        date: item.date,
        type: item.type,
        country: item.country,
        location: item.location,
        fatalities: item.fatalities || 0,
        lat: item.lat || null,
        lon: item.lon || null,
      })),
    },
    gdelt: {
      totalArticles: gdeltData.totalArticles || 0,
      conflicts: safeArray(gdeltData.conflicts).length,
      economy: safeArray(gdeltData.economy).length,
      health: safeArray(gdeltData.health).length,
      crisis: safeArray(gdeltData.crisis).length,
      topTitles: safeArray(gdeltData.allArticles).slice(0, 5).map(item => item.title?.substring(0, 80)),
      geoPoints: safeArray(gdeltData.geoPoints).slice(0, 20).map(item => ({ lat: item.lat, lon: item.lon, name: (item.name || '').substring(0, 80), count: item.count || 1 })),
    },
    space: {
      totalNewObjects: spaceData.totalNewObjects || 0,
      militarySats: spaceData.militarySatellites || 0,
      militaryByCountry: spaceData.militaryByCountry || {},
      constellations: spaceData.constellations || {},
      iss: spaceData.iss || null,
      issPosition: null,
      stationPositions: [],
      recentLaunches: safeArray(spaceData.recentLaunches).slice(0, 10).map(item => ({
        name: item.name,
        country: item.country,
        epoch: item.epoch,
        apogee: item.apogee,
        perigee: item.perigee,
        type: item.objectType,
      })),
      launchByCountry: spaceData.launchByCountry || {},
      signals: spaceData.signals || [],
    },
    health: Object.entries(sources).map(([name, source]) => ({ n: name, err: Boolean(source?.error), stale: Boolean(source?.stale) })),
    news,
    markets,
    ideas: [],
    ideasSource: 'disabled',
    newsFeed: buildNewsFeed(news, gdeltData, tgUrgent, tgTop),
  };

  return V2;
}

