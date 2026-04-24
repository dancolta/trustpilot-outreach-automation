#!/usr/bin/env node
import 'dotenv/config';
import { updateScheduledTime } from './src/sheets.js';

// Scheduled times for each company
const SCHEDULE = [
  { company: 'BOXFOX, Inc.', time: new Date('2026-02-04T09:00:00-08:00') },
  { company: 'Triple Aught Design', time: new Date('2026-02-04T10:00:00-08:00') },
  { company: 'Faviana International', time: new Date('2026-02-04T11:00:00-08:00') },
  { company: 'Total Beauty Experience', time: new Date('2026-02-04T12:00:00-08:00') },
  { company: 'SlideBelts', time: new Date('2026-02-04T13:00:00-08:00') },
  { company: 'PQ Swim', time: new Date('2026-02-04T14:00:00-08:00') },
  { company: 'FANCL International, Inc.', time: new Date('2026-02-04T15:00:00-08:00') },
];

async function updateScheduleTimes() {
  console.log('\n📅 Updating Schedule Times in Google Sheet\n');
  console.log('═'.repeat(60));

  for (const schedule of SCHEDULE) {
    try {
      await updateScheduledTime(schedule.company, schedule.time, 'America/Los_Angeles');

      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });

      console.log(`✓ ${schedule.company.padEnd(30)} → ${formatter.format(schedule.time)} PST`);
    } catch (error) {
      console.log(`✗ ${schedule.company}: ${error.message}`);
    }
  }

  console.log('\n' + '═'.repeat(60));
  console.log('✅ Schedule times updated in Google Sheet\n');
}

updateScheduleTimes().catch(error => {
  console.error('Error:', error.message);
  process.exit(1);
});
