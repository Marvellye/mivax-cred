const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(express.json());

const SESSIONS_DIR = path.join(__dirname, 'sessions');
if (!fs.existsSync(SESSIONS_DIR)) {
  fs.mkdirSync(SESSIONS_DIR);
}

// --- Helpers ---

/**
 * Loads the storage state and converts cookies to a string for Axios headers.
 */
function getAuthHeaders(sessionId) {
  const sessionPath = path.join(SESSIONS_DIR, `${sessionId}.json`);
  if (!fs.existsSync(sessionPath)) return null;

  const storage = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
  
  // Format cookies for the 'Cookie' header
  const cookieStr = storage.cookies
    .filter(c => c.domain.includes('miva.university'))
    .map(c => `${c.name}=${c.value}`)
    .join('; ');

  // If there's a JWT in localStorage (for SIS routes), we could extract it here:
  // const sisOrigin = storage.origins?.find(o => o.origin.includes('sis.miva.university'));
  // const authStorage = sisOrigin?.localStorage?.find(i => i.name === 'auth-storage');
  // if (authStorage) ...

  return {
    headers: {
      'Cookie': cookieStr,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
  };
}

/**
 * Parses the course list from HTML
 */
function parseCourses(html) {
  const $ = cheerio.load(html);
  const courses = [];

  // Moodle Course Cards (based on your index.js selectors)
  $('div[data-course-id][data-region="course-content"]').each((i, el) => {
    const $el = $(el);
    const id = $el.attr('data-course-id');
    const $link = $el.find('a.coursename');
    const name = $link.find('span.multiline').text().trim();
    const url = $link.attr('href')?.trim();

    // Image extraction from inline style
    const imgDiv = $el.find('div.card-img.dashboard-card-img');
    let image = null;
    const bg = imgDiv.attr('style') || '';
    const match = bg.match(/url\(["']?(.*?)["']?\)/);
    if (match) image = match[1];

    if (id && name && url) {
      courses.push({ id, name, url, image });
    }
  });

  return courses;
}

/**
 * Parses course details from HTML
 */
function parseCourseDetails(html) {
  const $ = cheerio.load(html);
  
  const title = $('header#page-header h1.header-heading').text().trim();
  const category = $('header#page-header div.category span.badge').text().trim();
  
  const bgStyle = $('header#page-header').attr('style') || '';
  const bgMatch = bgStyle.match(/url\(["']?(.*?)["']?\)/);
  const backgroundImage = bgMatch ? bgMatch[1] : null;

  const instructors = [...new Set(
    $('div.instructor-info span.titles').map((i, el) => $(el).text().trim()).get()
  )];

  const progress = $('div.progressbar-text-wrapper span').first().text().trim();

  const description = $('div.coursesummary p')
    .map((i, el) => $(el).text().trim())
    .get()
    .filter(t => t.length > 0)
    .join('\n\n');

  const sections = [];
  // Matches sidebar or main content sections
  $('div.courseindex-section, li.section.main').each((i, sec) => {
    const $sec = $(sec);
    const sectionTitleLink = $sec.find('a[data-for="section_title"], h3.sectionname a, h3.section-title, .courseindex-link').first();
    const sectionName = sectionTitleLink.text().trim();
    const sectionId = $sec.attr('data-id') || $sec.attr('data-sectionid') || $sec.attr('data-number') || `sec-${i}`;

    const modules = [];
    $sec.find('li.courseindex-item[data-for="cm"], li.activity').each((j, mod) => {
      const $mod = $(mod);
      const $link = $mod.find('a.courseindex-link, a.aalink, a').first();
      const $name = $mod.find('span.instancename, span.courseindex-name, .text-truncate').first();
      
      const modName = $name.text().trim() || $link.text().trim();
      const modUrl = $link.attr('href')?.trim();
      const modId = $mod.attr('data-id') || $mod.attr('id')?.replace('module-', '');

      if (!modUrl || modUrl === '#' || modUrl.includes('togglecourseindexsection')) return;

      const completionImg = $mod.find('span[data-for="cm_completion"] img, div.completioninfo img, img.completionicon');
      const isCompleted = completionImg.attr('src')?.includes('completion_complete') || completionImg.attr('title')?.includes('Done');

      let type = 'unknown';
      if (modUrl.includes('/mod/page/')) type = 'page';
      else if (modUrl.includes('/mod/quiz/')) type = 'quiz';
      else if (modUrl.includes('/mod/url/')) type = 'url';
      else if (modUrl.includes('/mod/forum/')) type = 'forum';
      else if (modUrl.includes('/mod/assign/')) type = 'assignment';
      else if (modUrl.includes('/mod/feedback/')) type = 'feedback';

      modules.push({
        id: modId,
        type,
        name: modName.replace(/ (To do|Done|Quiz|Page|URL|Forum|Feedback|Assignment)$/i, '').trim(),
        url: modUrl,
        isCompleted: !!isCompleted
      });
    });

    if (sectionName && modules.length > 0) {
      sections.push({ id: sectionId, name: sectionName, modules });
    }
  });

  return { title, category, backgroundImage, description, instructors, progress, sections };
}

/**
 * Parses module details from HTML
 */
function parseModuleDetails(html, type) {
  const $ = cheerio.load(html);
  const title = $('h1.header-heading').text().trim();
  const result = { title, type };

  if (type === 'page' || type === 'url') {
    const iframes = $('iframe').map((i, el) => {
      const $f = $(el);
      return {
        src: $f.attr('src'),
        title: $f.attr('title') || null,
        width: $f.attr('width') || null,
        height: $f.attr('height') || null
      };
    }).get().filter(f => f.src && !f.src.includes('about:blank'));
    
    result.iframes = iframes;

    if (type === 'page') {
      result.contentHtml = $('div.generalbox').html()?.trim();
    }
  }

  if (type === 'quiz') {
    result.description = $('div.activity-description').text().trim();
    result.quizInfo = $('div.quizinfo p').map((i, el) => $(el).text().trim()).get();
    result.status = $('div.quizstartbuttondiv button').length > 0 ? 'available' : 'locked_or_completed';
  }

  const getNav = (selector) => {
    const href = $(selector).attr('href');
    if (!href || href === '#' || href.includes('section.php')) return null;
    try {
      const url = new URL(href);
      const id = url.searchParams.get('id');
      const typeMatch = url.pathname.match(/\/mod\/([^/]+)\//);
      return id && typeMatch ? { type: typeMatch[1], id } : null;
    } catch (e) { return null; }
  };

  result.navigation = {
    prev: getNav('#prev-activity-link'),
    next: getNav('#next-activity-link')
  };

  return result;
}

// --- Routes ---

/**
 * LOGIN: Hard to do without a browser if the site has anti-bot or complex JS auth.
 * For now, this route provides a placeholder or an attempt at direct POST.
 */
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  // NOTE: Direct HTTP login to Moodle often requires fetching a login token first.
  // This is a simplified attempt. If it fails, you might still need Playwright 
  // JUST for the initial login, then use light.js for everything else.
  try {
    const baseUrl = 'https://lms.miva.university';
    const session = axios.create({ withCredentials: true });

    // 1. Get login page to grab CSRF/Login token
    const resp = await session.get(`${baseUrl}/login/index.php`);
    const $ = cheerio.load(resp.data);
    const logintoken = $('input[name="logintoken"]').val();

    // 2. Post credentials
    const loginResp = await session.post(`${baseUrl}/login/index.php`, 
      new URLSearchParams({
        email: username, // The site uses 'email' as the input name
        password: password,
        logintoken: logintoken,
        anchor: ''
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    // If redirected to dashboard, we are in
    if (loginResp.data.includes('id="course-info-container"') || loginResp.request.path.includes('/my/')) {
      const sessionId = crypto.randomUUID();
      const cookies = loginResp.headers['set-cookie'] || [];
      
      // Save in a format compatible with your existing system
      const cookieData = cookies.map(c => {
        const parts = c.split(';')[0].split('=');
        return { name: parts[0], value: parts[1], domain: 'lms.miva.university', path: '/' };
      });

      fs.writeFileSync(path.join(SESSIONS_DIR, `${sessionId}.json`), JSON.stringify({ cookies: cookieData }));
      
      // Fetch initial courses
      const courses = parseCourses(loginResp.data);
      res.json({ sessionId, courses });
    } else {
      res.status(401).json({ error: 'Login failed - Check credentials or site structure' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/courses/:sessionId', async (req, res) => {
  const auth = getAuthHeaders(req.params.sessionId);
  if (!auth) return res.status(404).json({ error: 'Session not found' });

  try {
    // 1. Fetch the dashboard to get the sesskey from the HTML
    const { data: html } = await axios.get('https://lms.miva.university/my/courses.php', auth);
    
    // Extract sesskey using regex from "sesskey":"..." or "sesskey\":\"...\"
    const sesskeyMatch = html.match(/"sesskey":"([^"]+)"/);
    if (!sesskeyMatch) {
      return res.status(401).json({ error: 'Could not find sesskey. Session might be expired.' });
    }
    const sesskey = sesskeyMatch[1];

    // 2. Call the AJAX service for course overview
    const ajaxUrl = `https://lms.miva.university/lib/ajax/service.php?sesskey=${sesskey}&info=theme_remui_get_myoverviewcourses`;
    const payload = [{
      index: 0,
      methodname: "theme_remui_get_myoverviewcourses",
      args: {
        offset: 0,
        limit: 0, // 0 usually means all or a default
        classification: "all",
        sort: "ul.timeaccess desc",
        customfieldname: "",
        customfieldvalue: ""
      }
    }];

    const { data: ajaxResponse } = await axios.post(ajaxUrl, payload, auth);
    
    // 3. Parse the AJAX response to extract only specific fields
    const responseData = ajaxResponse[0];
    if (responseData.error) {
      return res.status(500).json({ error: 'Moodle AJAX error', details: responseData.exception });
    }

    const courses = (responseData.data?.courses || []).map(course => ({
      id: course.id,
      fullname: course.fullname,
      shortname: course.shortname,
      summary: course.summary, // Can be used as HTML or text
      activitydata: course.activitydata,
      viewurl: course.viewurl,
      courseimage: course.courseimage
    }));

    res.json({ courses });
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.message });
  }
});

app.get('/course/:id/:sessionId', async (req, res) => {
  const auth = getAuthHeaders(req.params.sessionId);
  if (!auth) return res.status(404).json({ error: 'Session not found' });

  try {
    const { data } = await axios.get(`https://lms.miva.university/course/view.php?id=${req.params.id}`, auth);
    const courseData = parseCourseDetails(data);
    res.json({ id: req.params.id, ...courseData });
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.message });
  }
});

app.get('/mod/:type/:id/:sessionId', async (req, res) => {
  const auth = getAuthHeaders(req.params.sessionId);
  if (!auth) return res.status(404).json({ error: 'Session not found' });

  try {
    const { data } = await axios.get(`https://lms.miva.university/mod/${req.params.type}/view.php?id=${req.params.id}`, auth);
    const modData = parseModuleDetails(data, req.params.type);
    res.json({ id: req.params.id, ...modData });
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.message });
  }
});

const PORT = 3001; // Using a different port to avoid conflict
app.listen(PORT, () => console.log(`Lightweight server running on http://localhost:${PORT}`));
