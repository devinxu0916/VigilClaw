import type { VigilClawDB } from './db.js';
import type { BudgetStatus } from './types.js';

export class CostGuard {
  constructor(private db: VigilClawDB) {}

  checkBudget(userId: string): BudgetStatus {
    const user = this.db.getUser(userId);
    if (!user) {
      return { exceeded: false, currentCost: 0, budgetLimit: 10.0, remaining: 10.0 };
    }

    const dayCost = this.db.getUserDayCost(userId);
    if (dayCost >= user.maxCostPerDay) {
      return {
        exceeded: true,
        reason: 'day_limit',
        currentCost: dayCost,
        budgetLimit: user.maxCostPerDay,
        remaining: 0,
      };
    }

    const monthCost = this.db.getUserMonthCost(userId);
    if (monthCost >= user.maxCostPerMonth) {
      return {
        exceeded: true,
        reason: 'month_limit',
        currentCost: monthCost,
        budgetLimit: user.maxCostPerMonth,
        remaining: 0,
      };
    }

    return {
      exceeded: false,
      currentCost: dayCost,
      budgetLimit: user.maxCostPerDay,
      remaining: user.maxCostPerDay - dayCost,
    };
  }

  formatExceededMessage(status: BudgetStatus): string {
    if (status.reason === 'day_limit') {
      return [
        `⛔ 今日预算已用完。`,
        `消耗: $${status.currentCost.toFixed(2)} / $${status.budgetLimit.toFixed(2)}`,
        `预算将于 UTC 00:00 重置。`,
      ].join('\n');
    }
    if (status.reason === 'month_limit') {
      return [
        `⛔ 本月预算已用完。`,
        `消耗: $${status.currentCost.toFixed(2)} / $${status.budgetLimit.toFixed(2)}`,
        `预算将于下月 1 日重置。`,
      ].join('\n');
    }
    return '⛔ 预算已用完。';
  }
}
