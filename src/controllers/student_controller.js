const axios = require('axios');
const { SIS_BASE_URL } = require('../config');
const { getSISAuthHeaders, SessionExpiredError } = require('../services/session_service');
const { handleRouteError } = require('../middleware/error_handler');

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

const getDashboard = async (req, res) => {
  const { sessionId } = req.params;
  const sisAuth = getSISAuthHeaders(sessionId);
  
  if (!sisAuth) {
    return res.status(401).json({ error: 'SIS session not found or token missing' });
  }

  try {
    const response = await axios.get(`${SIS_BASE_URL}/student/dashboard`, {
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

module.exports = {
  getMe,
  getPaymentRecords,
  getNotifications,
  getDashboard
};
