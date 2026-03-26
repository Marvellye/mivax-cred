const axios = require('axios');
const { SIS_BASE_URL } = require('../config');
const { getSISAuthHeaders, SessionExpiredError } = require('../services/session_service');
const { handleRouteError } = require('../middleware/error_handler');

// --- Helper: Private Dashboard Fetcher ---
const _getRawDashboardData = async (sessionId) => {
  const sisAuth = getSISAuthHeaders(sessionId);
  if (!sisAuth) {
    throw new Error('SIS session not found or token missing');
  }

  try {
    const response = await axios.get(`${SIS_BASE_URL}/student/dashboard`, {
      headers: sisAuth.headers
    });
    
    const root = response.data;
    // The SIS API often wraps the response in { status, message, data }
    // We want to return the inner 'data' for processing in specialized routes
    if (root && root.status === 'OK' && root.data) {
      return root.data;
    }
    return root;
  } catch (error) {
    if (error.response?.status === 401) {
      throw new SessionExpiredError();
    }
    throw error;
  }
};

const getMe = async (req, res) => {
  const { sessionId } = req.params;
  const sisAuth = getSISAuthHeaders(sessionId);
  
  if (!sisAuth) {
    return res.status(401).json({ error: 'SIS session not found or token missing' });
  }

  try {
    const response = await axios.get(`${SIS_BASE_URL}/auth/me`, {
      headers: sisAuth.headers
    });
    
    res.json(response.data);
  } catch (error) {
    if (error.response?.status === 401) {
      return handleRouteError(new SessionExpiredError(), sessionId, res);
    }
    res.status(error.response?.status || 500).json(error.response?.data || { error: error.message });
  }
};

const getPaymentRecords = async (req, res) => {
  const { sessionId } = req.params;
  const { page = 1, perPage = 10 } = req.query;
  const sisAuth = getSISAuthHeaders(sessionId);
  
  if (!sisAuth) {
    return res.status(401).json({ error: 'SIS session not found or token missing' });
  }

  try {
    const response = await axios.get(`${SIS_BASE_URL}/student/users/record?page=${page}&perPage=${perPage}`, {
      headers: sisAuth.headers
    });
    
    res.json(response.data);
  } catch (error) {
    if (error.response?.status === 401) {
      return handleRouteError(new SessionExpiredError(), sessionId, res);
    }
    res.status(error.response?.status || 500).json(error.response?.data || { error: error.message });
  }
};

const getDashboard = async (req, res) => {
  const { sessionId } = req.params;
  try {
    // For the full dashboard, we return exactly what SIS returns (including wrapper)
    const sisAuth = getSISAuthHeaders(sessionId);
    const response = await axios.get(`${SIS_BASE_URL}/student/dashboard`, {
      headers: sisAuth.headers
    });
    res.json(response.data);
  } catch (err) {
    handleRouteError(err, sessionId, res);
  }
};

const getNotifications = async (req, res) => {
  const { sessionId } = req.params;
  const { page = 1, perPage = 5 } = req.query;
  const sisAuth = getSISAuthHeaders(sessionId);
  
  if (!sisAuth) {
    return res.status(401).json({ error: 'SIS session not found or token missing' });
  }

  try {
    const response = await axios.get(`${SIS_BASE_URL}/student/notifications?page=${page}&perPage=${perPage}`, {
      headers: sisAuth.headers
    });
    
    res.json(response.data);
  } catch (error) {
    if (error.response?.status === 401) {
      return handleRouteError(new SessionExpiredError(), sessionId, res);
    }
    res.status(error.response?.status || 500).json(error.response?.data || { error: error.message });
  }
};

// --- Specialized Dashboard Routes ---

const getAcademicSummary = async (req, res) => {
  const { sessionId } = req.params;
  try {
    const data = await _getRawDashboardData(sessionId);
    res.json(data.summary || {});
  } catch (err) {
    handleRouteError(err, sessionId, res);
  }
};

const getAcademicLevels = async (req, res) => {
  const { sessionId } = req.params;
  try {
    const data = await _getRawDashboardData(sessionId);
    const levels = (data.programme_level_enrollment || []).map(level => ({
      level: level.level,
      status: level.status,
      start_date: level.start_date,
      end_date: level.end_date,
      academic_time_period_name: level.academic_time_period_name,
      course_summary: level.course_status_summary
    }));
    res.json({ levels });
  } catch (err) {
    handleRouteError(err, sessionId, res);
  }
};

const getTranscript = async (req, res) => {
  const { sessionId, level: targetLevel } = req.params;
  try {
    const data = await _getRawDashboardData(sessionId);
    const levelData = (data.programme_level_enrollment || []).find(l => l.level === targetLevel);
    
    if (!levelData) {
      return res.status(404).json({ error: `Level ${targetLevel} not found` });
    }

    const transcript = {
      level: levelData.level,
      total_grade_point: levelData.total_grade_point,
      semesters: (levelData.semesters || []).map(s => ({
        name: s.semester_name,
        type: s.semester_type,
        gpa: s.gpa,
        courses: (s.courses || []).map(c => ({
          code: c.course_code,
          name: c.course_name,
          unit: c.credit_unit,
          score: c.score,
          symbol: c.symbol,
          result: c.result,
          status: c.status
        }))
      }))
    };
    res.json(transcript);
  } catch (err) {
    handleRouteError(err, sessionId, res);
  }
};

const getFullTranscript = async (req, res) => {
  const { sessionId } = req.params;
  try {
    const data = await _getRawDashboardData(sessionId);
    const levels = (data.programme_level_enrollment || []).map(levelData => ({
      level: levelData.level,
      total_grade_point: levelData.total_grade_point,
      semesters: (levelData.semesters || []).map(s => ({
        name: s.semester_name,
        type: s.semester_type,
        gpa: s.gpa,
        courses: (s.courses || []).map(c => ({
          code: c.course_code,
          name: c.course_name,
          unit: c.credit_unit,
          score: c.score,
          symbol: c.symbol,
          result: c.result,
          status: c.status
        }))
      }))
    }));
    res.json({ levels });
  } catch (err) {
    handleRouteError(err, sessionId, res);
  }
};

const getCurrentCourses = async (req, res) => {
    const { sessionId } = req.params;
    try {
      const data = await _getRawDashboardData(sessionId);
      // Logic: Find the most recent level (usually at index 0 or the one with status 'enrolled' or newest date)
      const currentLevel = data.programme_level_enrollment?.[0]; 
      if (!currentLevel) return res.json({ courses: [] });
  
      const currentSemester = currentLevel.semesters?.[0];
      if (!currentSemester) return res.json({ courses: [] });
  
      const enrolledCourses = (currentSemester.courses || []).filter(c => c.status === 'ENROLLED');
      res.json({ 
          level: currentLevel.level,
          semester: currentSemester.semester_name,
          courses: enrolledCourses 
      });
    } catch (err) {
      handleRouteError(err, sessionId, res);
    }
  };

const getRegistrationStatus = async (req, res) => {
  const { sessionId } = req.params;
  try {
    const data = await _getRawDashboardData(sessionId);
    const currentLevel = data.programme_level_enrollment?.[0];
    if (!currentLevel) return res.json({ status: 'No active enrollment' });

    res.json({
        level: currentLevel.level,
        status: currentLevel.status,
        enrollment_start: currentLevel.start_date,
        enrollment_end: currentLevel.end_date,
        is_pending: currentLevel.status === 'PENDING'
    });
  } catch (err) {
    handleRouteError(err, sessionId, res);
  }
};

module.exports = {
  getMe,
  getPaymentRecords,
  getNotifications,
  getDashboard,
  getAcademicSummary,
  getAcademicLevels,
  getTranscript,
  getFullTranscript,
  getCurrentCourses,
  getRegistrationStatus
};
