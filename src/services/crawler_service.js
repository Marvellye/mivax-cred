const { chromium } = require('playwright');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { SESSIONS_DIR } = require('../config');
const { getAuthHeaders, SessionExpiredError } = require('./session_service');
const { proxyImg } = require('../utils/proxy_img');

let browser;

async function getBrowser() {
  if (!browser) {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage'
      ]
    });
  }
  return browser;
}

async function login(username, password) {
  const browser = await getBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // 1. Fetch JWT tokens FAST via API
    const response = await fetch('https://sis-be.miva.university/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/plain, */*',
        'Origin': 'https://sis.miva.university',
        'Referer': 'https://sis.miva.university/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0',
        'x-origin-portal': 'student'
      },
      body: JSON.stringify({ email: username, password: password })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(`Login failed: ${response.status}`);

    // Speedup: Block all heavy static resources
    await page.route('**/*', route => {
      const type = route.request().resourceType();
      if (['image', 'media', 'font', 'stylesheet'].includes(type)) {
        route.abort();
      } else {
        route.continue();
      }
    });

    // 2. Inject state into SIS frontend SUPER FAST, avoiding waiting for full network
    await page.goto('https://sis.miva.university', { waitUntil: 'commit' });
    await page.evaluate((tokenData) => {
      localStorage.setItem('auth-storage', JSON.stringify({
        state: { access_token: tokenData.access_token, refresh_token: tokenData.refresh_token, user: null, isAuthenticated: true },
        version: 0
      }));
    }, data.data);

    // 3. Navigate directly to CAS auth callback and intercept the cookie instantly!
    const sessionId = crypto.randomUUID();
    const sessionPath = path.join(SESSIONS_DIR, `${sessionId}.json`);
    
    // We navigate and parallelize cookie checking
    page.goto('https://lms.miva.university/login/index.php?authCASattras=CASattras').catch(() => {});

    // Poll for the MoodleSession cookie instead of waiting for the heavy page to hydrate
    for (let i = 0; i < 50; i++) {
        const cookies = await context.cookies();
        if (cookies.some(c => c.name === 'MoodleSession' && c.domain.includes('miva.university'))) {
            break; // Stop waiting as soon as we got the authentication cookie!
        }
        await page.waitForTimeout(200);
    }
    
    // Grab the final state instantly
    const storageState = await context.storageState();
    
    // Emulate existing app requirements
    storageState.origins = [{
      origin: 'https://sis.miva.university',
      localStorage: [{ name: 'auth-storage', value: JSON.stringify({ state: { access_token: data.data.access_token } }) }]
    }];

    fs.writeFileSync(sessionPath, JSON.stringify(storageState));
    
    return sessionId;
  } finally {
    await context.close();
  }
}

async function fetchCoursesViaAjax(sessionId) {
  const auth = getAuthHeaders(sessionId);
  if (!auth) throw new Error('Session not found');

  // 1. Fetch page to get sesskey
  const response = await axios.get('https://lms.miva.university/my/courses.php', {
    ...auth,
    maxRedirects: 5,
    validateStatus: (status) => status < 400
  });

  // If redirected to login
  if (response.request.path.includes('login/index.php')) {
    throw new SessionExpiredError();
  }

  const html = response.data;
  const sesskeyMatch = html.match(/"sesskey":"([^"]+)"/);
  if (!sesskeyMatch) throw new SessionExpiredError('Could not find sesskey');
  const sesskey = sesskeyMatch[1];

  // 2. Call AJAX service
  const ajaxUrl = `https://lms.miva.university/lib/ajax/service.php?sesskey=${sesskey}&info=theme_remui_get_myoverviewcourses`;
  const payload = [{
    index: 0,
    methodname: "theme_remui_get_myoverviewcourses",
    args: {
      offset: 0,
      limit: 0,
      classification: "all",
      sort: "ul.timeaccess desc",
      customfieldname: "",
      customfieldvalue: ""
    }
  }];

  const { data: ajaxResponse } = await axios.post(ajaxUrl, payload, auth);
  const responseData = ajaxResponse[0];
  if (responseData.error) {
    if (responseData.exception?.errorcode === 'invalidsesskey') {
      throw new SessionExpiredError();
    }
    throw new Error(responseData.exception?.message || 'Moodle AJAX error');
  }

  return (responseData.data?.courses || []).map(course => ({
    id: course.id,
    startdate: course.startdate,
    fullname: course.fullname,
    shortname: course.shortname,
    summary: course.summary,
    activitydata: course.activitydata,
    viewurl: course.viewurl,
    courseimage: proxyImg(course.courseimage, sessionId)
  }));
}

module.exports = {
  login,
  fetchCoursesViaAjax
};
