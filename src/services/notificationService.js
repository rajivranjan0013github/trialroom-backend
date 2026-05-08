import admin from '../utils/firebaseAdmin.js';

/**
 * Sends a push notification to a specific user via FCM token
 * @param {string} fcmToken - The target user's FCM device token
 * @param {string} title - Title of the notification
 * @param {string} body - Body text of the notification
 * @param {string} imageUrl - (Optional) URL of the image to display in the notification
 * @param {string} screen - (Optional) The screen to navigate to when tapped
 * @returns {Promise<object>} - Result of the send operation
 */
export const sendPushNotification = async (fcmToken, title, body, imageUrl = null, screen = null) => {
  if (!fcmToken) {
    throw new Error('FCM token is required to send notification');
  }

  const message = {
    token: fcmToken,
    notification: {
      title,
      body,
    },
    data: {}, // Initialize data payload
  };

  // Add screen to data if provided
  if (screen) {
    message.data.screen = screen;
  }

  // Add image if provided
  if (imageUrl) {
    message.notification.image = imageUrl;
    message.data.imageUrl = imageUrl;
    
    // Android-specific options for image
    message.android = {
      notification: {
        imageUrl: imageUrl,
      },
    };

    // iOS-specific options for image (Requires mutable-content for Notification Service Extension)
    message.apns = {
      payload: {
        aps: {
          'mutable-content': 1,
        },
      },
      fcm_options: {
        image: imageUrl,
      },
    };
  }

  try {
    const response = await admin.messaging().send(message);
    return { success: true, response };
  } catch (error) {
    console.error('[NotificationService] Error sending FCM message:', error);
    return { success: false, error: error.message };
  }
};
