const express = require('express');
const bookingController = require('./../controllers/bookingController');
const authController = require('./../controllers/authController');
const userController = require('./../controllers/userController');

const router = express.Router();

router.use(authController.protect);

router.get(
  '/checkout-session/:tourId/:date',
  bookingController.getCheckoutSession
);

router.get(
  '/my-bookings',
  userController.getMe,
  bookingController.getMyBooking
);

router.get('/tour/:tourId/status', bookingController.checkTourBookingStatus);

router.use(authController.restrictTo('admin', 'lead-guide'));

router
  .route('/')
  .get(bookingController.getAllBookings)
  .post(bookingController.createBooking);

router
  .route('/:id')
  .get(bookingController.getBooking)
  .patch(bookingController.updateBooking)
  .delete(bookingController.deleteBooking);

router.post('/:id/refund', bookingController.refundPayment);

module.exports = router;
