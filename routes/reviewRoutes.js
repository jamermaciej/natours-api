const express = require('express');
const reviewController = require('./../controllers/reviewController');
const authController = require('./../controllers/authController');
const userController = require('./../controllers/userController');

const router = express.Router({ mergeParams: true });

router.use(authController.protect);

router
  .get('/my-reviews', userController.getMe, reviewController.getMyReviews);

router
  .route('/')
  .get(reviewController.getAllReviews)
  .post(
    authController.restrictTo('user'),
    reviewController.setTourUserIds,
    reviewController.checkIsUserBooking,
    reviewController.createReview
  );

router
  .route('/:id')
  .get(reviewController.getReview)
  .patch(
    authController.restrictTo('user', 'admin'),
    reviewController.updateReview
  )
  .delete(
    authController.restrictTo('user', 'admin'),
    reviewController.deleteReview
  );

module.exports = router;
