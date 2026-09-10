const express = require('express');
const router = express.Router();
const axios = require('axios');
const PlayerProfile = require('../models/PlayerProfile');

/**
 * KONAMI eFOOTBALL API INTEGRATION
 * Integration-ready for official Konami eFootball API
 * When official API becomes available, replace placeholder logic with actual calls
 */

// Check if Konami API is available
const isKonamiAPIAvailable = () => {
  return process.env.EFOOTBALL_API_KEY && 
         process.env.EFOOTBALL_API_URL &&
         process.env.EFOOTBALL_API_KEY !== 'your_api_key_here';
};

// Search eFootball account by ID
router.post('/search-account', async (req, res) => {
  try {
    const { gameId, efootballUsername, platform } = req.body;

    // Validation
    if (!gameId && !efootballUsername) {
      return res.status(400).json({ 
        error: 'Game ID or eFootball username is required' 
      });
    }

    if (!platform) {
      return res.status(400).json({ 
        error: 'Platform is required (Android, iOS, PlayStation, Xbox, PC)' 
      });
    }

    // Check if account already registered
    const existingAccount = await PlayerProfile.findOne({ gameId });
    if (existingAccount) {
      return res.status(409).json({ 
        error: 'This eFootball account has already been registered in the tournament' 
      });
    }

    // If official API is available, use it
    if (isKonamiAPIAvailable()) {
      try {
        const response = await axios.post(
          `${process.env.EFOOTBALL_API_URL}/account/verify`,
          {
            gameId,
            username: efootballUsername,
            platform
          },
          {
            headers: {
              'Authorization': `Bearer ${process.env.EFOOTBALL_API_KEY}`,
              'Content-Type': 'application/json'
            },
            timeout: 5000
          }
        );

        return res.json({
          message: 'eFootball account verified',
          verified: true,
          account: {
            gameId: response.data.gameId,
            username: response.data.username,
            platform: response.data.platform,
            country: response.data.country,
            rank: response.data.rank,
            level: response.data.level,
            totalMatches: response.data.totalMatches,
            verificationStatus: 'verified',
            verifiedAt: new Date()
          }
        });
      } catch (apiError) {
        console.log('⚠️ Konami API verification failed:', apiError.message);
        // Fall back to placeholder verification
      }
    }

    // Placeholder verification (when official API is not available)
    return res.json({
      message: 'eFootball account verification is currently unavailable. Please verify manually.',
      verified: false,
      account: {
        gameId: gameId || 'GAME_ID_' + Math.random().toString(36).substring(7),
        username: efootballUsername,
        platform,
        verificationStatus: 'pending',
        note: 'Official Konami API integration is ready. When API key is provided, verification will be automatic.'
      },
      apiStatus: 'INTEGRATION_READY',
      instructions: 'Enter your eFootball Game ID and username. Admin will manually verify your account.'
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Verify account by manual admin approval
router.post('/verify-account-manual', async (req, res) => {
  try {
    const { userId, gameId, efootballUsername, platform, countryFlag } = req.body;

    // Find or create player profile
    let playerProfile = await PlayerProfile.findOne({ userId });

    if (!playerProfile) {
      playerProfile = new PlayerProfile({
        userId,
        efootballUsername,
        gameId,
        platform,
        countryFlag,
        accountVerificationStatus: 'verified'
      });
    } else {
      playerProfile.efootballUsername = efootballUsername;
      playerProfile.gameId = gameId;
      playerProfile.platform = platform;
      playerProfile.countryFlag = countryFlag;
      playerProfile.accountVerificationStatus = 'verified';
    }

    await playerProfile.save();

    res.json({
      message: 'Account verified successfully',
      profile: playerProfile,
      status: 'verified'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Lookup account details
router.get('/lookup/:gameId', async (req, res) => {
  try {
    const { gameId } = req.params;

    // Check in local database first
    const playerProfile = await PlayerProfile.findOne({ gameId })
      .populate('userId', 'username email country');

    if (playerProfile) {
      return res.json({
        found: true,
        account: {
          gameId: playerProfile.gameId,
          username: playerProfile.efootballUsername,
          platform: playerProfile.platform,
          player: playerProfile.userId.username,
          email: playerProfile.userId.email,
          country: playerProfile.userId.country,
          statistics: playerProfile.statistics,
          verificationStatus: playerProfile.accountVerificationStatus
        }
      });
    }

    // If official API is available, lookup from Konami
    if (isKonamiAPIAvailable()) {
      try {
        const response = await axios.get(
          `${process.env.EFOOTBALL_API_URL}/account/lookup/${gameId}`,
          {
            headers: {
              'Authorization': `Bearer ${process.env.EFOOTBALL_API_KEY}`,
              'Content-Type': 'application/json'
            },
            timeout: 5000
          }
        );

        return res.json({
          found: true,
          account: {
            gameId: response.data.gameId,
            username: response.data.username,
            platform: response.data.platform,
            country: response.data.country,
            rank: response.data.rank,
            level: response.data.level,
            totalMatches: response.data.totalMatches,
            verificationStatus: 'verified'
          }
        });
      } catch (apiError) {
        console.log('⚠️ Konami API lookup failed:', apiError.message);
      }
    }

    res.json({
      found: false,
      message: 'Account not found in our database',
      gameId,
      note: 'Please register and verify your account first'
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all registered Konami accounts (Admin only)
router.get('/admin/accounts-list', async (req, res) => {
  try {
    const accounts = await PlayerProfile.find()
      .populate('userId', 'username email country accountStatus')
      .select('efootballUsername gameId platform accountVerificationStatus statistics');

    res.json({
      total: accounts.length,
      accounts
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Search multiple accounts by criteria
router.post('/search-bulk', async (req, res) => {
  try {
    const { platform, country, verificationStatus } = req.body;
    
    const query = {};
    if (platform) query.platform = platform;
    if (verificationStatus) query.accountVerificationStatus = verificationStatus;

    let results = await PlayerProfile.find(query)
      .populate('userId', 'username email country');

    if (country) {
      results = results.filter(r => r.userId.country === country);
    }

    res.json({
      total: results.length,
      results,
      filters: { platform, country, verificationStatus }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get API status and configuration
router.get('/status', async (req, res) => {
  res.json({
    apiAvailable: isKonamiAPIAvailable(),
    apiUrl: process.env.EFOOTBALL_API_URL || 'Not configured',
    verificationMethod: isKonamiAPIAvailable() ? 'Automatic (Official API)' : 'Manual (Admin Approval)',
    status: 'INTEGRATION_READY',
    documentation: 'https://efootballleague.site/api/docs/konami'
  });
});

module.exports = router;
