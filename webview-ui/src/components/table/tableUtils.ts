import type { StatisticsMessage } from '../../../../src/shared/messages/gridData';

export function getColumnCellIndex(columnId: string): number | null {
	if (!columnId.startsWith('col-')) {
		return null;
	}

	const index = Number(columnId.slice(4));
	return Number.isInteger(index) ? index : null;
}

export function getDataRowCount(currentStats: StatisticsMessage): number {
	const availableRows = currentStats.isFinal ? currentStats.rowCount : currentStats.readableRowCount;
	return Math.max(0, availableRows);
}
