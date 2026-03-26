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
    await page.route('**/*', route => {
      const type = route.request().resourceType();
      if (['image', 'font', 'stylesheet', 'media'].includes(type) && !route.request().url().includes('miva')) {
        route.abort();
      } else {
        route.continue();
      }
    });

    await page.goto('https://lms.miva.university', { waitUntil: 'domcontentloaded' });

    if (!page.url().includes('/my/')) {
      await page.waitForSelector('input[name="email"]', { timeout: 10000 });
      await page.fill('input[name="email"]', username);
      await page.fill('input[name="password"]', password);
      await page.click('button:has-text("Login")');

      await Promise.race([
        page.waitForSelector('div#page-content, .courseindex-link', { timeout: 45000 }),
        page.waitForSelector('text=Incorrect email or password', { timeout: 15000 }).then(() => {
          throw new Error('Incorrect email or password');
        })
      ]);
    }

    const sessionId = crypto.randomUUID();
    const sessionPath = path.join(SESSIONS_DIR, `${sessionId}.json`);
    await context.storageState({ path: sessionPath });
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
