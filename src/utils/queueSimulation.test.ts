import test from 'node:test';
import assert from 'node:assert/strict';
import { runQueueCapacitySimulation, type SimTransaction } from './queueSimulation.ts';

test('runQueueCapacitySimulation limits reviews to capacity and prioritizes expected loss', () => {
  const dummyAlerts: SimTransaction[] = [
    {
      id: 'tx-1',
      amount: 4000,
      predictedProbability: 0.85, // Exp Loss = $3400
      groundTruthLabel: 1,
    },
    {
      id: 'tx-2',
      amount: 15,
      predictedProbability: 0.99, // Exp Loss = $14.85
      groundTruthLabel: 1,
    },
    {
      id: 'tx-3',
      amount: 1200,
      predictedProbability: 0.70, // Exp Loss = $840
      groundTruthLabel: 0, // False alert
    },
  ];

  // If capacity is 1:
  // Under 'Highest Risk Score': tx-2 is reviewed (risk 0.99), captures only $15
  const riskResult = runQueueCapacitySimulation(dummyAlerts, 1, 'Highest Risk Score', 20);
  assert.equal(riskResult.totalReviewed, 1);
  assert.equal(riskResult.fraudDollarsCaptured, 15);

  // Under 'Highest Expected Dollar Loss': tx-1 is reviewed ($3400 exp loss), captures $4000!
  const dollarResult = runQueueCapacitySimulation(dummyAlerts, 1, 'Highest Expected Dollar Loss', 20);
  assert.equal(dollarResult.totalReviewed, 1);
  assert.equal(dollarResult.fraudDollarsCaptured, 4000);
});
