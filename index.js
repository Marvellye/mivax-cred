const express = require('express');
const cors = require('cors');
const { chromium } = require('playwright');
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

const SESSIONS_DIR = path.join(__dirname, 'sessions');
if (!fs.existsSync(SESSIONS_DIR)) {
  fs.mkdirSync(SESSIONS_DIR);
}

let browser;
(async () => {
    browser = await chromium.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage'
        ]   
    });
})();

// --- Helper: Auth Headers from Session File ---

function getAuthHeaders(sessionId) {
    const sessionPath = path.join(SESSIONS_DIR, `${sessionId}.json`);
    if (!fs.existsSync(sessionPath)) return null;

    const storage = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
    
    const cookieStr = storage.cookies
        .filter(c => c.domain.includes('miva.university'))
        .map(c => `${c.name}=${c.value}`)
        .join('; ');

    return {
        headers: {
            'Cookie': cookieStr,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
    };
}

// --- Helper: Course Parser (for legacy fallback if needed) ---

function parseCourses(html) {
    const $ = cheerio.load(html);
    const courses = [];
    $('div[data-course-id][data-region="course-content"]').each((i, el) => {
        const $el = $(el);
        const id = $el.attr('data-course-id');
        const $link = $el.find('a.coursename');
        const name = $link.find('span.multiline').text().trim();
        const url = $link.attr('href')?.trim();
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

// --- Custom Errors ---
class SessionExpiredError extends Error {
    constructor(message = 'Session expired') {
        super(message);
        this.name = 'SessionExpiredError';
        this.status = 401;
    }
}

// --- Helper: Handle Route Errors ---
function handleRouteError(err, sessionId, res) {
    if (err instanceof SessionExpiredError) {
        const sessionPath = path.join(SESSIONS_DIR, `${sessionId}.json`);
        if (fs.existsSync(sessionPath)) {
            fs.unlinkSync(sessionPath);
        }
        return res.status(401).json({ error: 'Session expired' });
    }
    res.status(500).json({ error: err.message });
}

// --- Helper: AJAX Course Fetcher ---

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
        fullname: course.fullname,
        shortname: course.shortname,
        summary: course.summary,
        activitydata: course.activitydata,
        viewurl: course.viewurl,
        courseimage: course.courseimage
    }));
}

// --- Helper: Content Parsers ---

function parseCourseDetails(html) {
    const $ = cheerio.load(html);
    const title = $('header#page-header h1.header-heading').text().trim();
    const category = $('header#page-header div.category span.badge').text().trim();
    const bgStyle = $('header#page-header').attr('style') || '';
    const bgMatch = bgStyle.match(/url\(["']?(.*?)["']?\)/);
    const backgroundImage = bgMatch ? bgMatch[1] : null;
    const instructors = [...new Set($('div.instructor-info span.titles').map((i, el) => $(el).text().trim()).get())];
    const progress = $('div.progressbar-text-wrapper span').first().text().trim();
    const description = $('div.coursesummary p').map((i, el) => $(el).text().trim()).get().filter(t => t.length > 0).join('\n\n');

    const sections = [];
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
                id: modId, type,
                name: modName.replace(/ (To do|Done|Quiz|Page|URL|Forum|Feedback|Assignment)$/i, '').trim(),
                url: modUrl, isCompleted: !!isCompleted
            });
        });
        if (sectionName && modules.length > 0) sections.push({ id: sectionId, name: sectionName, modules });
    });
    return { title, category, backgroundImage, description, instructors, progress, sections };
}

function parseModuleDetails(html, type) {
    const $ = cheerio.load(html);
    const title = $('h1.header-heading').text().trim();
    const result = { title, type };
    if (type === 'page' || type === 'url') {
        result.iframes = $('iframe').map((i, el) => ({
            src: $(el).attr('src'),
            title: $(el).attr('title') || null,
            width: $(el).attr('width') || null,
            height: $(el).attr('height') || null
        })).get().filter(f => f.src && !f.src.includes('about:blank'));
        if (type === 'page') result.contentHtml = $('div.generalbox').html()?.trim();
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
    result.navigation = { prev: getNav('#prev-activity-link'), next: getNav('#next-activity-link') };
    return result;
}

// --- MAIN ROUTES ---

// 1. HEAVY LOGIN (Playwright)
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const context = await browser.newContext();
        const page = await context.newPage();

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
        await context.close();

        res.json({ sessionId });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 2. LIGHT COURSES (Axios/AJAX)
app.get('/courses/:sessionId', async (req, res) => {
    try {
        const courses = await fetchCoursesViaAjax(req.params.sessionId);
        res.json({ courses });
    } catch (err) {
        handleRouteError(err, req.params.sessionId, res);
    }
});

// 3. LIGHT COURSE DETAILS (Axios/Cheerio)
app.get('/course/:id/:sessionId', async (req, res) => {
    const sessionId = req.params.sessionId;
    const auth = getAuthHeaders(sessionId);
    if (!auth) return res.status(404).json({ error: 'Session not found' });
    try {
        const response = await axios.get(`https://lms.miva.university/course/view.php?id=${req.params.id}`, {
            ...auth,
            maxRedirects: 5
        });

        if (response.request.path.includes('login/index.php')) {
            throw new SessionExpiredError();
        }

        const courseData = parseCourseDetails(response.data);
        res.json({ id: req.params.id, ...courseData });
    } catch (err) {
        handleRouteError(err, sessionId, res);
    }
});

// 4. LIGHT MODULE DETAILS (Axios/Cheerio)
app.get('/mod/:type/:id/:sessionId', async (req, res) => {
    const sessionId = req.params.sessionId;
    const auth = getAuthHeaders(sessionId);
    if (!auth) return res.status(404).json({ error: 'Session not found' });
    try {
        const response = await axios.get(`https://lms.miva.university/mod/${req.params.type}/view.php?id=${req.params.id}`, {
            ...auth,
            maxRedirects: 5
        });

        if (response.request.path.includes('login/index.php')) {
            throw new SessionExpiredError();
        }

        const modData = parseModuleDetails(response.data, req.params.type);
        res.json({ id: req.params.id, ...modData });
    } catch (err) {
        handleRouteError(err, sessionId, res);
    }
});

app.listen(3000, () => console.log('Hybrid Scraper Server running on http://localhost:3000'));
