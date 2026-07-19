/**
 * packages/phase6-tradingview/src/exposure/SectorMapper.ts
 * Artha AI — Phase 6 Risk Engine — Stage 1
 *
 * Maps symbol tickers to NSE sector categories.
 * Used for sector exposure concentration checks.
 *
 * This is a static lookup — zero I/O. In production, this map
 * would be hydrated from the Phase 3 symbols table on startup.
 */

// Sector enum aligned with NSE sector classification
export type NSESector =
  | 'BANKING_FINANCIAL'
  | 'IT_TECHNOLOGY'
  | 'FMCG_CONSUMER'
  | 'PHARMA_HEALTHCARE'
  | 'AUTO_ANCILLARIES'
  | 'METALS_MINING'
  | 'OIL_GAS'
  | 'REALTY'
  | 'INFRASTRUCTURE'
  | 'TELECOM'
  | 'POWER_UTILITIES'
  | 'CHEMICALS'
  | 'CEMENT'
  | 'MEDIA_ENTERTAINMENT'
  | 'AGRICULTURE'
  | 'DIVERSIFIED'
  | 'UNKNOWN';

const SECTOR_MAP: Record<string, NSESector> = {
  // Banking & Financial
  HDFCBANK: 'BANKING_FINANCIAL',
  ICICIBANK: 'BANKING_FINANCIAL',
  SBIN: 'BANKING_FINANCIAL',
  KOTAKBANK: 'BANKING_FINANCIAL',
  AXISBANK: 'BANKING_FINANCIAL',
  BAJFINANCE: 'BANKING_FINANCIAL',
  BAJAJFINSV: 'BANKING_FINANCIAL',
  SHRIRAMFIN: 'BANKING_FINANCIAL',
  HDFCLIFE: 'BANKING_FINANCIAL',
  SBILIFE: 'BANKING_FINANCIAL',
  // IT
  TCS: 'IT_TECHNOLOGY',
  INFY: 'IT_TECHNOLOGY',
  WIPRO: 'IT_TECHNOLOGY',
  HCLTECH: 'IT_TECHNOLOGY',
  TECHM: 'IT_TECHNOLOGY',
  LTIM: 'IT_TECHNOLOGY',
  MPHASIS: 'IT_TECHNOLOGY',
  PERSISTENT: 'IT_TECHNOLOGY',
  // FMCG
  HINDUNILVR: 'FMCG_CONSUMER',
  NESTLEIND: 'FMCG_CONSUMER',
  BRITANNIA: 'FMCG_CONSUMER',
  DABUR: 'FMCG_CONSUMER',
  GODREJCP: 'FMCG_CONSUMER',
  MARICO: 'FMCG_CONSUMER',
  ITC: 'FMCG_CONSUMER',
  TATACONSUM: 'FMCG_CONSUMER',
  // Pharma
  SUNPHARMA: 'PHARMA_HEALTHCARE',
  DRREDDY: 'PHARMA_HEALTHCARE',
  CIPLA: 'PHARMA_HEALTHCARE',
  DIVISLAB: 'PHARMA_HEALTHCARE',
  AUROPHARMA: 'PHARMA_HEALTHCARE',
  APOLLOHOSP: 'PHARMA_HEALTHCARE',
  // Auto
  MARUTI: 'AUTO_ANCILLARIES',
  TATAMOTORS: 'AUTO_ANCILLARIES',
  M_AND_M: 'AUTO_ANCILLARIES',
  BAJAJ_AUTO: 'AUTO_ANCILLARIES',
  HEROMOTOCO: 'AUTO_ANCILLARIES',
  EICHERMOT: 'AUTO_ANCILLARIES',
  // Metals
  TATASTEEL: 'METALS_MINING',
  HINDALCO: 'METALS_MINING',
  JSWSTEEL: 'METALS_MINING',
  COALINDIA: 'METALS_MINING',
  VEDL: 'METALS_MINING',
  NMDC: 'METALS_MINING',
  // Oil & Gas
  RELIANCE: 'OIL_GAS',
  ONGC: 'OIL_GAS',
  IOC: 'OIL_GAS',
  BPCL: 'OIL_GAS',
  // Power
  POWERGRID: 'POWER_UTILITIES',
  NTPC: 'POWER_UTILITIES',
  ADANIPOWER: 'POWER_UTILITIES',
  // Telecom
  BHARTIARTL: 'TELECOM',
};

export class SectorMapper {
  private readonly sectorMap: Map<string, NSESector>;

  constructor(override?: Record<string, NSESector>) {
    const combined = { ...SECTOR_MAP, ...override };
    this.sectorMap = new Map(Object.entries(combined));
  }

  getSector(ticker: string): NSESector {
    return this.sectorMap.get(ticker.toUpperCase()) ?? 'UNKNOWN';
  }

  hydrate(entries: Array<{ ticker: string; sector: NSESector }>): void {
    for (const { ticker, sector } of entries) {
      this.sectorMap.set(ticker.toUpperCase(), sector);
    }
  }
}
