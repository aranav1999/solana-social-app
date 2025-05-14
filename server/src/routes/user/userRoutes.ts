/**
 * File: server/src/routes/profileImageRoutes.ts
 *
 * A router that handles:
 * - Uploading profile images (stored on IPFS via uploadToIpfs)
 * - Basic profile fetch/update (username, attach coin, follow/unfollow, etc.)
 */

import {Router, Request, Response, NextFunction} from 'express';
import multer from 'multer';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import os from 'os';
import knex from '../../db/knex';
import {uploadToIpfs} from '../../utils/ipfs';
// import fetch from 'node-fetch';

// Assuming userController and requireAuth are structured like this
// import * as userController from '../../controllers/userController'; // This line is removed
// import { requireAuth } from '../../middleware/requireAuth'; // Assuming path - REMOVED

// Import the new user service function
import { deleteUserAccount as deleteUserAccountService } from '../../service/userService'; 

const profileImageRouter = Router();
const upload = multer({storage: multer.memoryStorage()});

/**
 * ------------------------------------------
 *  EXISTING: Upload profile image logic
 * ------------------------------------------
 */
profileImageRouter.post(
  '/upload',
  upload.single('profilePic'),
  async (req: any, res: any) => {
    try {
      const userId = req.body.userId;
      if (!userId) {
        return res.status(400).json({success: false, error: 'Missing userId'});
      }
      if (!req.file) {
        return res
          .status(400)
          .json({success: false, error: 'No file uploaded'});
      }

      // 1) Compress the image using sharp
      const outputFormat = 'jpeg';
      const compressedBuffer = await sharp(req.file.buffer)
        .resize({width: 1024, withoutEnlargement: true})
        .toFormat(outputFormat, {quality: 80})
        .toBuffer();

      // 2) Write to a temp file
      const tempFileName = `profile-${userId}-${Date.now()}.${outputFormat}`;
      const tempFilePath = path.join(os.tmpdir(), tempFileName);
      await fs.promises.writeFile(tempFilePath, compressedBuffer);

      // 3) Prepare IPFS metadata
      const metadata = {
        name: 'Profile Picture',
        symbol: 'PFP',
        description: `Profile picture for user ${userId}`,
        showName: false,
      };

      // 4) Upload image to IPFS
      const ipfsResult = await uploadToIpfs(tempFilePath, metadata);

      // 5) Clean up temp file
      await fs.promises.unlink(tempFilePath);

      // 6) Attempt to fetch the returned metadata JSON
      let ipfsImageUrl = ipfsResult;
      const {default: fetch} = await import('node-fetch');
      const metadataResponse = await fetch(ipfsResult);
      if (metadataResponse.ok) {
        const metadataJson: any = await metadataResponse.json();
        if (metadataJson.image) {
          ipfsImageUrl = metadataJson.image;
        }
      }

      // 7) Upsert user in "users" table, setting profile_picture_url
      const existingUser = await knex('users').where({id: userId}).first();
      if (!existingUser) {
        await knex('users').insert({
          id: userId,
          username: userId, // default
          handle: '@' + userId.slice(0, 6),
          profile_picture_url: ipfsImageUrl,
          created_at: new Date(),
          updated_at: new Date(),
        });
      } else {
        await knex('users').where({id: userId}).update({
          profile_picture_url: ipfsImageUrl,
          updated_at: new Date(),
        });
      }

      return res.json({success: true, url: ipfsImageUrl});
    } catch (error: any) {
      console.error('[Profile upload error]', error);
      return res.status(500).json({success: false, error: error.message});
    }
  },
);

/**
 * ------------------------------------------
 *  EXISTING: Fetch user's profile data
 * ------------------------------------------
 */
profileImageRouter.get('/', async (req: any, res: any) => {
  try {
    const userId = req.query.userId;
    if (!userId) {
      return res.status(400).json({success: false, error: 'Missing userId'});
    }

    const user = await knex('users').where({id: userId}).first();
    if (!user) {
      return res.status(404).json({success: false, error: 'User not found'});
    }

    // Return the user's data, including the attachment_data field.

    console.log(user , "user.attachment_data");
    return res.json({
      success: true,
      url: user.profile_picture_url,
      username: user.username,
      description: user.description || '',
      attachmentData: user.attachment_data || {}, // e.g., { coin: { mint, symbol, name, image, description } }
    });
  } catch (error: any) {
    console.error('[Profile fetch error]', error);
    return res.status(500).json({success: false, error: error.message});
  }
});

/**
 * ------------------------------------------
 *  EXISTING: Update user's username
 * ------------------------------------------
 */
profileImageRouter.post('/updateUsername', async (req: any, res: any) => {
  try {
    const {userId, username} = req.body;
    if (!userId || !username) {
      return res
        .status(400)
        .json({success: false, error: 'Missing userId or username'});
    }

    const existingUser = await knex('users').where({id: userId}).first();
    if (!existingUser) {
      await knex('users').insert({
        id: userId,
        username,
        handle: '@' + userId.slice(0, 6),
        profile_picture_url: null,
        created_at: new Date(),
        updated_at: new Date(),
      });
    } else {
      await knex('users').where({id: userId}).update({
        username,
        updated_at: new Date(),
      });
    }

    return res.json({success: true, username});
  } catch (error: any) {
    console.error('[updateUsername error]', error);
    return res.status(500).json({success: false, error: error.message});
  }
});

/**
 * ------------------------------------------
 *  NEW: Follow a user
 *  Body: { followerId, followingId }
 * ------------------------------------------
 */
profileImageRouter.post('/follow', async (req: any, res: any) => {
  try {
    const {followerId, followingId} = req.body;
    if (!followerId || !followingId) {
      return res
        .status(400)
        .json({success: false, error: 'Missing followerId or followingId'});
    }
    if (followerId === followingId) {
      return res
        .status(400)
        .json({success: false, error: 'Cannot follow yourself'});
    }

    // Ensure both users exist
    const followerExists = await knex('users').where({id: followerId}).first();
    const followingExists = await knex('users')
      .where({id: followingId})
      .first();
    if (!followerExists || !followingExists) {
      return res
        .status(404)
        .json({success: false, error: 'Follower or following user not found'});
    }

    // Insert into follows if not already present
    await knex('follows')
      .insert({
        follower_id: followerId,
        following_id: followingId,
      })
      .onConflict(['follower_id', 'following_id'])
      .ignore();

    return res.json({success: true});
  } catch (error: any) {
    console.error('[Follow user error]', error);
    return res.status(500).json({success: false, error: error.message});
  }
});

/**
 * ------------------------------------------
 *  NEW: Unfollow a user
 *  Body: { followerId, followingId }
 * ------------------------------------------
 */
profileImageRouter.post('/unfollow', async (req: any, res: any) => {
  try {
    const {followerId, followingId} = req.body;
    if (!followerId || !followingId) {
      return res
        .status(400)
        .json({success: false, error: 'Missing followerId or followingId'});
    }

    // Delete from follows table
    await knex('follows')
      .where({follower_id: followerId, following_id: followingId})
      .del();

    return res.json({success: true});
  } catch (error: any) {
    console.error('[Unfollow user error]', error);
    return res.status(500).json({success: false, error: error.message});
  }
});

/**
 * ------------------------------------------
 *  NEW: GET list of a user's followers
 *  Query param: ?userId=xxx
 * ------------------------------------------
 */
profileImageRouter.get('/followers', async (req: any, res: any) => {
  try {
    const userId = req.query.userId;
    if (!userId) {
      return res
        .status(400)
        .json({success: false, error: 'Missing userId param'});
    }

    const rows = await knex('follows')
      .select('follower_id')
      .where({following_id: userId});

    const followerIds = rows.map(r => r.follower_id);

    // Optional: fetch user details
    const followers = await knex('users').whereIn('id', followerIds);

    return res.json({
      success: true,
      followers,
    });
  } catch (error: any) {
    console.error('[Get followers error]', error);
    return res.status(500).json({success: false, error: error.message});
  }
});

/**
 * ------------------------------------------
 *  NEW: GET list of a user's following
 *  Query param: ?userId=xxx
 * ------------------------------------------
 */
profileImageRouter.get('/following', async (req: any, res: any) => {
  try {
    const userId = req.query.userId;
    if (!userId) {
      return res
        .status(400)
        .json({success: false, error: 'Missing userId param'});
    }

    const rows = await knex('follows')
      .select('following_id')
      .where({follower_id: userId});

    const followingIds = rows.map(r => r.following_id);

    // Optional: fetch user details
    const following = await knex('users').whereIn('id', followingIds);

    return res.json({
      success: true,
      following,
    });
  } catch (error: any) {
    console.error('[Get following error]', error);
    return res.status(500).json({success: false, error: error.message});
  }
});

/**
 * ------------------------------------------
 *  NEW: Attach or update a coin on the user's profile
 *  Body: { userId, attachmentData } where attachmentData = {
 *    coin: { mint: string; symbol?: string; name?: string; image?: string; description?: string; }
 *  }
 * ------------------------------------------
 */
profileImageRouter.post('/attachCoin', async (req: any, res: any) => {
  try {
    const {userId, attachmentData} = req.body;
    /**
     * Example of attachmentData:
     * {
     *   coin: {
     *     mint: string;
     *     symbol?: string;
     *     name?: string;
     *     image?: string;       // from Helius
     *     description?: string; // user-provided
     *   }
     * }
     */
    if (
      !userId ||
      !attachmentData ||
      !attachmentData.coin ||
      !attachmentData.coin.mint
    ) {
      return res.status(400).json({
        success: false,
        error:
          'Missing userId or valid attachmentData (must include coin with mint)',
      });
    }

    // Ensure user exists
    const existingUser = await knex('users').where({id: userId}).first();
    if (!existingUser) {
      return res.status(404).json({success: false, error: 'User not found'});
    }

    // We store the entire object under "attachment_data" => { coin: {...} }
    await knex('users').where({id: userId}).update({
      attachment_data: attachmentData,
      updated_at: new Date(),
    });

    return res.json({
      success: true,
      attachmentData,
    });
  } catch (error: any) {
    console.error('[AttachCoin error]', error);
    return res.status(500).json({success: false, error: error.message});
  }
});

/**
 * ------------------------------------------
 *  Remove an attached coin from the user's profile
 *  Body: { userId }
 * ------------------------------------------
 */
profileImageRouter.post('/removeAttachedCoin', async (req: any, res: any) => {
  try {
    const {userId} = req.body;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'Missing userId',
      });
    }

    // Ensure user exists
    const existingUser = await knex('users').where({id: userId}).first();
    if (!existingUser) {
      return res.status(404).json({success: false, error: 'User not found'});
    }

    // Get current attachment data
    const currentAttachmentData = existingUser.attachment_data || {};

    // Remove the coin property from the attachment data
    if (currentAttachmentData.coin) {
      delete currentAttachmentData.coin;
    }

    // Update the user record
    await knex('users').where({id: userId}).update({
      attachment_data: currentAttachmentData,
      updated_at: new Date(),
    });

    return res.json({
      success: true,
    });
  } catch (error: any) {
    console.error('[RemoveAttachedCoin error]', error);
    return res.status(500).json({success: false, error: error.message});
  }
});

profileImageRouter.get('/search', async (req: any, res: any) => {
  try {
    const searchQuery = req.query.q;
    let users;

    if (searchQuery) {
      // Search by username if query parameter is provided
      users = await knex('users')
        .where('username', 'ilike', `%${searchQuery}%`)
        .select('id', 'username', 'profile_picture_url')
        .orderBy('username', 'asc');
    } else {
      // Return all users if no query parameter
      users = await knex('users')
        .select('id', 'username', 'profile_picture_url')
        .orderBy('username', 'asc');
    }

    return res.json({
      success: true,
      users,
    });
  } catch (error: any) {
    console.error('[User search error]', error);
    return res.status(500).json({success: false, error: error.message});
  }
});

/**
 * ------------------------------------------
 *  NEW: Create a new user
 *  Body: { userId, username, handle }
 * ------------------------------------------
 */
profileImageRouter.post('/createUser', async (req: any, res: any) => {
  try {
    const { userId, username, handle, description } = req.body;
    if (!userId) {
      return res.status(400).json({ success: false, error: 'Missing userId' });
    }

    // Check if user already exists
    const existingUser = await knex('users').where({ id: userId }).first();
    if (existingUser) {
      // User already exists, just return success
      return res.json({ success: true, user: existingUser });
    }

    // Create new user with minimal data
    const newUser = {
      id: userId,
      username: username || userId, // Default to userId if username not provided
      handle: handle || '@' + userId.slice(0, 6), // Default handle if not provided
      description: description || '', // Default empty description if not provided
      profile_picture_url: null,
      attachment_data: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    await knex('users').insert(newUser);

    return res.json({ success: true, user: newUser });
  } catch (error: any) {
    console.error('[Create user error]', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * ------------------------------------------
 *  NEW: Update user's description
 * ------------------------------------------
 */
profileImageRouter.post('/updateDescription', async (req: any, res: any) => {
  try {
    const {userId, description} = req.body;
    if (!userId) {
      return res
        .status(400)
        .json({success: false, error: 'Missing userId'});
    }

    const existingUser = await knex('users').where({id: userId}).first();
    if (!existingUser) {
      await knex('users').insert({
        id: userId,
        username: userId,
        handle: '@' + userId.slice(0, 6),
        description: description || '',
        profile_picture_url: null,
        created_at: new Date(),
        updated_at: new Date(),
      });
    } else {
      await knex('users').where({id: userId}).update({
        description: description || '',
        updated_at: new Date(),
      });
    }

    return res.json({success: true, description: description || ''});
  } catch (error: any) {
    console.error('[updateDescription error]', error);
    return res.status(500).json({success: false, error: error.message});
  }
});

/**
 * ------------------------------------------
 *  NEW: Delete user account
 *  WARNING: Authentication removed for now. userId must be passed in body.
 *  THIS IS INSECURE FOR PRODUCTION.
 * ------------------------------------------
 */
profileImageRouter.delete(
  '/delete-account',
  // requireAuth, // Middleware REMOVED
  async (req: any, res: any, next: NextFunction) => {
    console.log(`[Route /delete-account] Received request. Body:`, req.body);
    try {
      const { userId } = req.body; // userId now expected from request body
      
      console.log(`[Route /delete-account] Extracted userId: ${userId}`);

      if (!userId) {
        console.error('[Route /delete-account] Error: userId is missing from request body.');
        return res.status(400).json({ success: false, error: 'userId is required in the request body.' });
      }

      console.log(`[Route /delete-account] Calling deleteUserAccountService for userId: ${userId}`);
      await deleteUserAccountService(userId);
      
      console.log(`[Route /delete-account] Successfully deleted account for userId: ${userId}`);
      return res.status(200).json({ success: true, message: 'Account deleted successfully.' });
    } catch (error: any) {
      console.error('[Delete Account Route Error]', error);
      if (error.message.includes('User not found')) {
        return res.status(404).json({ success: false, error: error.message });
      }
      return res.status(500).json({ success: false, error: error.message || 'Failed to delete account.' });
    }
  },
);

export default profileImageRouter;
