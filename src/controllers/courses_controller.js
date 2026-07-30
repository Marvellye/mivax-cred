const axios = require('axios');
const crawlerService = require('../services/crawler_service');
const parserService = require('../services/parser_service');
const vimeoService = require('../services/vimeo_service');
const { getAuthHeaders, SessionExpiredError } = require('../services/session_service');
const { handleRouteError } = require('../middleware/error_handler');

const getCourses = async (req, res) => {
  try {
    const courses = await crawlerService.fetchCoursesViaAjax(req.params.sessionId);
    res.json({ courses });
  } catch (err) {
    handleRouteError(err, req.params.sessionId, res);
  }
};

const getCourseDetails = async (req, res) => {
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

    const courseData = parserService.parseCourseDetails(response.data, sessionId);
    res.json({ id: req.params.id, ...courseData });
  } catch (err) {
    handleRouteError(err, sessionId, res);
  }
};

const getModuleDetails = async (req, res) => {
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

    const modData = parserService.parseModuleDetails(response.data, req.params.type);

    // Enrich with Vimeo metadata when the module embeds a Vimeo video.
    // Best-effort: failures are swallowed so the module response still works.
    try {
      if (vimeoService.hasVimeoEmbed(modData, response.data)) {
        const ids = vimeoService.extractVimeoIds({
          iframes: modData.iframes,
          contentHtml: modData.contentHtml,
          html: response.data
        });
        const videos = [];
        for (const id of ids.slice(0, 3)) {
          try { videos.push(await vimeoService.getVimeoMeta(id)); }
          catch { /* skip unreachable video */ }
        }
        if (videos.length) modData.vimeo = videos;
      }
    } catch { /* vimeo enrichment is non-fatal */ }

    res.json({ id: req.params.id, ...modData });
  } catch (err) {
    handleRouteError(err, sessionId, res);
  }
};

module.exports = {
  getCourses,
  getCourseDetails,
  getModuleDetails
};
