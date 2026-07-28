const mongoose = require('mongoose');

const BookingSchema = new mongoose.Schema({
    bookingId: { type: String, required: true, unique: true },
    pickUpDate: String,
    pickUpTime: String,
    clientName: String,
    vendorName: { type: String, default: "" },
    chauffeurName: { type: String, default: "" },
    chauffeurPhone: { type: String, default: "" },
    pickupAddress: String,
    dropAddress: String,
    serviceType: { type: String, default: "" },
    zone: String,
    status: { type: String, default: "Upcoming" },
    // updates: { type: String, default: "" },
    remarks: { type: String, default: "" },
    chargeable: { type: String, default: "" },
    secondPickupCharged: { type: String, default: "" },
    secondPickupAmount: { type: Number, default: 0 },
    amountAED: { type: Number, default: 0 },
    bookingSource: { type: String, default: "" },
    flightNumber: { type: String, default: "" },
    noOfLuggages: { type: Number, default: 0 },
    noOfPassengers: { type: Number, default: 0 },
    noOfInfants: { type: Number, default: 0 },
    noOfBaby: { type: Number, default: 0 },
    carType: { type: String, default: "" },
    carNumber: { type: String, default: "" },
    startKm: { type: Number, default: 0 },
    endKm: { type: Number, default: 0 },
    customerName: { type: String, default: "" },
    customerMobile: { type: String, default: "" },
    distanceTravelledByCar: { type: Number, default: 0 },
    distanceKm: { type: Number, default: 0 },
    uploadedAt: { type: String, default: () => new Date().toLocaleString() },
    pickUpRegion: { type: String, default: "" },
    pickUpCountry: { type: String, default: "" },
    pickUpZipcode: { type: String, default: "" },
    dropRegion: { type: String, default: "" },
    dropCountry: { type: String, default: "" },
    dropZipcode: { type: String, default: "" }

});

// Explicitly forces connection targeting to your exact collection 'Booking'
module.exports = mongoose.model('Booking', BookingSchema, 'Booking');