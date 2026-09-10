const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Tournament = require('../models/Tournament');
const Payment = require('../models/Payment');
const Match = require('../models/Match');
const Dispute = require('../models/Dispute');
const Group = require('../models/Group');
const PlayerProfile = require('../models/PlayerProfile');
const jwt = require('jsonwebtoken');

/**
 * ADMIN AUTHENTICATION MIDDLEWARE
 * Verify admin role and JWT token
 */
const adminAuth = (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Apply admin auth to all admin routes
router.use(adminAuth);

/**
 * ADMIN DASHBOARD - GET STATISTICS
 */
router.get('/dashboard/stats', async (req, res) => {
  try {
    const stats = {
      players: {
        total: await User.countDocuments({ role: 'player' }),
        active: await User.countDocuments({ role: 'player', accountStatus: 'active' }),
        suspended: await User.countDocuments({ role: 'player', accountStatus: 'suspended' }),
        banned: await User.countDocuments({ role: 'player', accountStatus: 'banned' }),
        verified: await User.countDocuments({ role: 'player', accountVerified: true })
      },
      tournaments: {
        total: await Tournament.countDocuments(),
        open: await Tournament.countDocuments({ status: 'open' }),
        active: await Tournament.countDocuments({ status: 'in-progress' }),
        completed: await Tournament.countDocuments({ status: 'completed' })
      },
      payments: {
        pending: await Payment.countDocuments({ status: 'pending' }),
        completed: await Payment.countDocuments({ status: 'completed' }),
        failed: await Payment.countDocuments({ status: 'failed' })
      },
      matches: {
        total: await Match.countDocuments(),
        upcoming: await Match.countDocuments({ status: 'upcoming' }),
        live: await Match.countDocuments({ status: 'live' }),
        completed: await Match.countDocuments({ status: 'completed' }),
        disputed: await Match.countDocuments({ status: 'disputed' })
      },
      disputes: {
        open: await Dispute.countDocuments({ status: 'open' }),
        reviewing: await Dispute.countDocuments({ status: 'reviewing' }),
        resolved: await Dispute.countDocuments({ status: 'resolved' })
      },
      revenue: {
        total: await getRevenueTotal(),
        pending: await getRevenuePending()
      }
    };

    res.json({
      timestamp: new Date(),
      stats
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * ADMIN PLAYERS MANAGEMENT
 */

// Get all players with pagination
router.get('/players', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const players = await User.find({ role: 'player' })
      .select('-password')
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 });

    const total = await User.countDocuments({ role: 'player' });

    res.json({
      players,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Search players
router.get('/players/search', async (req, res) => {
  try {
    const { query } = req.query;

    if (!query) {
      return res.status(400).json({ error: 'Search query is required' });
    }

    const players = await User.find({
      role: 'player',
      $or: [
        { username: { $regex: query, $options: 'i' } },
        { email: { $regex: query, $options: 'i' } },
        { fullName: { $regex: query, $options: 'i' } },
        { country: { $regex: query, $options: 'i' } }
      ]
    })
      .select('-password')
      .limit(50);

    res.json({
      query,
      results: players,
      total: players.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get player details
router.get('/players/:playerId', async (req, res) => {
  try {
    const user = await User.findById(req.params.playerId).select('-password');
    if (!user) {
      return res.status(404).json({ error: 'Player not found' });
    }

    const playerProfile = await PlayerProfile.findOne({ userId: req.params.playerId });
    const matches = await Match.countDocuments({
      $or: [{ playerA: req.params.playerId }, { playerB: req.params.playerId }]
    });

    res.json({
      user,
      profile: playerProfile,
      matchesPlayed: matches
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update player status
router.put('/players/:playerId/status', async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['active', 'suspended', 'banned'];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const user = await User.findByIdAndUpdate(
      req.params.playerId,
      { accountStatus: status, updatedAt: Date.now() },
      { new: true }
    ).select('-password');

    res.json({
      message: `Player status updated to ${status}`,
      user
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Verify player account
router.put('/players/:playerId/verify', async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.params.playerId,
      { accountVerified: true, updatedAt: Date.now() },
      { new: true }
    ).select('-password');

    res.json({
      message: 'Player account verified',
      user
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * ADMIN TOURNAMENT MANAGEMENT
 */

// Get all tournaments
router.get('/tournaments', async (req, res) => {
  try {
    const tournaments = await Tournament.find()
      .populate('createdBy', 'username email')
      .sort({ createdAt: -1 });

    res.json({
      total: tournaments.length,
      tournaments
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create tournament
router.post('/tournaments/create', async (req, res) => {
  try {
    const {
      name,
      description,
      entryFee,
      prizePool,
      maxPlayers,
      registrationDeadline,
      startDate,
      endDate,
      platform,
      numberOfGroups,
      playersPerGroup,
      rules,
      prizes
    } = req.body;

    // Validation
    if (!name || !entryFee || !prizePool || !maxPlayers) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const tournament = new Tournament({
      name,
      description,
      entryFee,
      prizePool,
      maxPlayers,
      registrationDeadline,
      startDate,
      endDate,
      platform: platform || 'All',
      numberOfGroups: numberOfGroups || 32,
      playersPerGroup: playersPerGroup || 8,
      rules,
      prizes,
      status: 'draft',
      createdBy: req.user.id
    });

    await tournament.save();

    res.status(201).json({
      message: 'Tournament created successfully',
      tournament
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update tournament
router.put('/tournaments/:tournamentId', async (req, res) => {
  try {
    const tournament = await Tournament.findByIdAndUpdate(
      req.params.tournamentId,
      { ...req.body, updatedAt: Date.now() },
      { new: true }
    );

    res.json({
      message: 'Tournament updated',
      tournament
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update tournament status
router.put('/tournaments/:tournamentId/status', async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['draft', 'open', 'registering', 'closed', 'in-progress', 'completed'];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const tournament = await Tournament.findByIdAndUpdate(
      req.params.tournamentId,
      { status, updatedAt: Date.now() },
      { new: true }
    );

    res.json({
      message: `Tournament status updated to ${status}`,
      tournament
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * ADMIN GROUP MANAGEMENT
 */

// Generate groups for tournament
router.post('/tournaments/:tournamentId/generate-groups', async (req, res) => {
  try {
    const tournament = await Tournament.findById(req.params.tournamentId);

    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    // TODO: Implement group generation algorithm
    // For now, return success message

    res.json({
      message: 'Groups generated successfully',
      tournament: tournament._id,
      numberOfGroups: tournament.numberOfGroups,
      playersPerGroup: tournament.playersPerGroup,
      note: 'Group generation algorithm to be implemented'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * ADMIN MATCH MANAGEMENT
 */

// Get all matches
router.get('/matches', async (req, res) => {
  try {
    const matches = await Match.find()
      .populate('playerA', 'username')
      .populate('playerB', 'username')
      .populate('tournamentId', 'name')
      .sort({ scheduledTime: -1 });

    res.json({
      total: matches.length,
      matches
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get match details
router.get('/matches/:matchId', async (req, res) => {
  try {
    const match = await Match.findById(req.params.matchId)
      .populate('playerA')
      .populate('playerB')
      .populate('tournamentId');

    if (!match) {
      return res.status(404).json({ error: 'Match not found' });
    }

    res.json(match);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * ADMIN DISPUTES MANAGEMENT
 */

// Get all disputes
router.get('/disputes', async (req, res) => {
  try {
    const disputes = await Dispute.find()
      .populate('matchId')
      .populate('reportedBy', 'username')
      .sort({ createdAt: -1 });

    res.json({
      total: disputes.length,
      disputes
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get dispute details
router.get('/disputes/:disputeId', async (req, res) => {
  try {
    const dispute = await Dispute.findById(req.params.disputeId)
      .populate('matchId')
      .populate('reportedBy');

    if (!dispute) {
      return res.status(404).json({ error: 'Dispute not found' });
    }

    res.json(dispute);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Resolve dispute
router.put('/disputes/:disputeId/resolve', async (req, res) => {
  try {
    const { resolution, decision, comments } = req.body;
    const validResolutions = ['upheld', 'dismissed', 'rematch'];

    if (!validResolutions.includes(resolution)) {
      return res.status(400).json({ error: 'Invalid resolution' });
    }

    const dispute = await Dispute.findByIdAndUpdate(
      req.params.disputeId,
      {
        status: 'resolved',
        resolution,
        'adminReview.decision': decision,
        'adminReview.comments': comments,
        'adminReview.reviewedBy': req.user.id,
        'adminReview.reviewedAt': Date.now(),
        updatedAt: Date.now()
      },
      { new: true }
    );

    res.json({
      message: 'Dispute resolved',
      dispute
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * ADMIN PAYMENTS MANAGEMENT
 */

// Get all payments
router.get('/payments', async (req, res) => {
  try {
    const payments = await Payment.find()
      .populate('userId', 'username email')
      .populate('tournamentId', 'name')
      .sort({ createdAt: -1 });

    res.json({
      total: payments.length,
      payments
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update payment status
router.put('/payments/:paymentId/status', async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['pending', 'processing', 'completed', 'failed', 'refunded'];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const payment = await Payment.findByIdAndUpdate(
      req.params.paymentId,
      { status, completedAt: status === 'completed' ? Date.now() : null },
      { new: true }
    );

    res.json({
      message: 'Payment status updated',
      payment
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * HELPER FUNCTIONS
 */

async function getRevenueTotal() {
  try {
    const result = await Payment.aggregate([
      { $match: { status: 'completed' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    return result[0]?.total || 0;
  } catch (error) {
    return 0;
  }
}

async function getRevenuePending() {
  try {
    const result = await Payment.aggregate([
      { $match: { status: 'pending' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    return result[0]?.total || 0;
  } catch (error) {
    return 0;
  }
}

module.exports = router;
