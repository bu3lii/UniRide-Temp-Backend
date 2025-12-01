/**
 * Database Seeder
 * Creates sample data for testing
 * Run with: npm run seed
 */

require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const config = require('../config');

// Import models
const { User, Ride, Booking, Review, Notification } = require('../models');

// Sample data
const users = [
  {
    name: 'Ahmed Al-Khalifa',
    email: 'ahmed.khalifa@aubh.edu.bh',
    universityId: '202100001',
    password: 'Password123!',
    phoneNumber: '+97333001001',
    gender: 'male',
    isEmailVerified: true,
    isDriver: true,
    carDetails: {
      model: 'Toyota Camry 2022',
      color: 'Silver',
      licensePlate: 'ABC1234',
      totalSeats: 4
    }
  },
  {
    name: 'Fatima Hassan',
    email: 'fatima.hassan@aubh.edu.bh',
    universityId: '202100002',
    password: 'Password123!',
    phoneNumber: '+97333002002',
    gender: 'female',
    isEmailVerified: true,
    isDriver: true,
    carDetails: {
      model: 'Honda Accord 2021',
      color: 'White',
      licensePlate: 'XYZ5678',
      totalSeats: 4
    }
  },
  {
    name: 'Mohammed Yusuf',
    email: 'mohammed.yusuf@aubh.edu.bh',
    universityId: '202100003',
    password: 'Password123!',
    phoneNumber: '+97333003003',
    gender: 'male',
    isEmailVerified: true,
    isDriver: false
  },
  {
    name: 'Sara Ahmed',
    email: 'sara.ahmed@aubh.edu.bh',
    universityId: '202100004',
    password: 'Password123!',
    phoneNumber: '+97333004004',
    gender: 'female',
    isEmailVerified: true,
    isDriver: false
  },
  {
    name: 'Ali Ibrahim',
    email: 'ali.ibrahim@aubh.edu.bh',
    universityId: '202100005',
    password: 'Password123!',
    phoneNumber: '+97333005005',
    gender: 'male',
    isEmailVerified: true,
    isDriver: true,
    carDetails: {
      model: 'Nissan Altima 2023',
      color: 'Black',
      licensePlate: 'DEF9012',
      totalSeats: 4
    }
  }
];

// Bahrain locations
const locations = [
  {
    name: 'AUBH Campus',
    address: 'American University of Bahrain, Riffa',
    coordinates: { lat: 26.1234, lng: 50.5456 }
  },
  {
    name: 'Riffa Views',
    address: 'Riffa Views, Bahrain',
    coordinates: { lat: 26.1156, lng: 50.5589 }
  },
  {
    name: 'Seef Mall',
    address: 'Seef District, Manama',
    coordinates: { lat: 26.2357, lng: 50.5476 }
  },
  {
    name: 'Bahrain City Centre',
    address: 'Bahrain City Centre, Manama',
    coordinates: { lat: 26.2189, lng: 50.5822 }
  },
  {
    name: 'Juffair',
    address: 'Juffair, Manama',
    coordinates: { lat: 26.2100, lng: 50.6000 }
  },
  {
    name: 'Muharraq',
    address: 'Muharraq, Bahrain',
    coordinates: { lat: 26.2578, lng: 50.6117 }
  }
];

// Helper to get random future date
const getRandomFutureDate = (daysAhead = 7) => {
  const now = new Date();
  const randomDays = Math.floor(Math.random() * daysAhead) + 1;
  const randomHours = Math.floor(Math.random() * 12) + 7; // 7 AM to 7 PM
  const date = new Date(now);
  date.setDate(date.getDate() + randomDays);
  date.setHours(randomHours, 0, 0, 0);
  return date;
};

// Seeder function
const seedDatabase = async () => {
  try {
    // Connect to database
    await mongoose.connect(config.mongodbUri);
    console.log('Connected to MongoDB');

    // Clear existing data
    console.log('Clearing existing data...');
    await User.deleteMany({});
    await Ride.deleteMany({});
    await Booking.deleteMany({});
    await Review.deleteMany({});
    await Notification.deleteMany({});

    // Create users
    console.log('Creating users...');
    const createdUsers = [];
    for (const userData of users) {
      const user = await User.create(userData);
      createdUsers.push(user);
      console.log(`  Created user: ${user.name}`);
    }

    // Create rides
    console.log('Creating rides...');
    const rides = [];
    const drivers = createdUsers.filter(u => u.isDriver);

    for (const driver of drivers) {
      // Create 2-3 rides per driver
      const numRides = Math.floor(Math.random() * 2) + 2;
      
      for (let i = 0; i < numRides; i++) {
        const startIdx = Math.floor(Math.random() * locations.length);
        let endIdx = Math.floor(Math.random() * locations.length);
        while (endIdx === startIdx) {
          endIdx = Math.floor(Math.random() * locations.length);
        }

        const ride = await Ride.create({
          driver: driver._id,
          startLocation: {
            address: locations[startIdx].address,
            coordinates: locations[startIdx].coordinates
          },
          destination: {
            address: locations[endIdx].address,
            coordinates: locations[endIdx].coordinates
          },
          route: {
            distance: Math.floor(Math.random() * 20000) + 5000, // 5-25 km
            duration: Math.floor(Math.random() * 1800) + 600 // 10-40 min
          },
          departureTime: getRandomFutureDate(),
          totalSeats: driver.carDetails.totalSeats,
          availableSeats: driver.carDetails.totalSeats,
          pricePerSeat: Math.floor(Math.random() * 3) + 1, // 1-3 BHD
          genderPreference: ['any', 'any', 'male', 'female'][Math.floor(Math.random() * 4)]
        });

        rides.push(ride);
        console.log(`  Created ride: ${locations[startIdx].name} → ${locations[endIdx].name}`);
      }
    }

    // Create some bookings
    console.log('Creating bookings...');
    const passengers = createdUsers.filter(u => !u.isDriver);
    
    for (const passenger of passengers) {
      // Book 1-2 rides per passenger
      const availableRides = rides.filter(r => 
        r.driver.toString() !== passenger._id.toString() && 
        r.availableSeats > 0
      );

      if (availableRides.length > 0) {
        const ride = availableRides[Math.floor(Math.random() * availableRides.length)];
        
        const booking = await Booking.create({
          ride: ride._id,
          passenger: passenger._id,
          seatsBooked: 1,
          totalAmount: ride.pricePerSeat,
          status: 'confirmed',
          confirmedAt: new Date()
        });

        // Update ride seats
        ride.availableSeats -= 1;
        await ride.save();

        console.log(`  Created booking for ${passenger.name}`);
      }
    }

    // Create welcome notifications
    console.log('Creating notifications...');
    for (const user of createdUsers) {
      await Notification.createNotification('system_announcement', user._id, {
        title: 'Welcome to UniRide!',
        message: 'Start sharing rides with fellow AUBH students today.'
      });
    }

    console.log('\n✅ Database seeded successfully!');
    console.log('\nTest Accounts:');
    console.log('─'.repeat(50));
    for (const user of users) {
      console.log(`Email: ${user.email}`);
      console.log(`Password: ${user.password}`);
      console.log(`Driver: ${user.isDriver ? 'Yes' : 'No'}`);
      console.log('─'.repeat(50));
    }

    process.exit(0);
  } catch (error) {
    console.error('Seeding error:', error);
    process.exit(1);
  }
};

// Run seeder
seedDatabase();
