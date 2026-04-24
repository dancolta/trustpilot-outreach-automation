#!/usr/bin/env node

// Recreate the same schedule calculation from schedule-emails.js
function calculateSendTimes(count) {
  const times = [];

  // Get current date
  const startDate = new Date();

  // Start tomorrow at 9am PT (skip weekend logic for now - it's Friday)
  startDate.setDate(startDate.getDate() + 1);

  // Set to 9:00 AM PT (9am PT = 5pm UTC)
  const baseTime = new Date(startDate);
  baseTime.setUTCHours(17, 0, 0, 0);

  // Spread emails: 9am to 6pm = 9 hours = 540 minutes
  const intervalMinutes = Math.floor(540 / (count - 1));

  for (let i = 0; i < count; i++) {
    const sendTime = new Date(baseTime);
    sendTime.setMinutes(sendTime.getMinutes() + (i * intervalMinutes));
    times.push(sendTime);
  }

  return times;
}

// Generate schedule for 9 emails
const sendTimes = calculateSendTimes(9);

// Formatters for both timezones
const laFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles',
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
  timeZoneName: 'short'
});

const localFormatter = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
  timeZoneName: 'short'
});

console.log('='.repeat(90));
console.log('SCHEDULED EMAIL TIMES - Dual Timezone Display');
console.log('='.repeat(90));
console.log('');

sendTimes.forEach((time, i) => {
  const laTime = laFormatter.format(time);
  const localTime = localFormatter.format(time);

  console.log(`Email ${i + 1}:`);
  console.log(`  Los Angeles Time: ${laTime}`);
  console.log(`  Local Time:       ${localTime}`);
  console.log('');
});

console.log('='.repeat(90));
