/**
 * Enum de tipos de conta do NetSuite
 */
export const AccountType = Object.freeze({
  Bank: 'Bank',
  AcctRec: 'AcctRec',
  OthCurrAsset: 'OthCurrAsset',
  FixedAsset: 'FixedAsset',
  OthAsset: 'OthAsset',
  AcctPay: 'AcctPay',
  OthCurrLiab: 'OthCurrLiab',
  LongTermLiab: 'LongTermLiab',
  Equity: 'Equity',
  Income: 'Income',
  COGS: 'COGS',
  Expense: 'Expense',
  DeferRevenue: 'DeferRevenue',
  DeferExpense: 'DeferExpense',
  UnbilledRec: 'UnbilledRec',
});

/**
 * Lista de todos os AccountTypes validos
 */
export const VALID_ACCOUNT_TYPES = Object.values(AccountType);

/**
 * Enum de tipos de taxa geral para conversão cambial (multi-moeda)
 *
 * Determina como o saldo da conta é traduzido ao consolidar subsidiárias
 * com moedas diferentes:
 *
 * - Current: taxa de câmbio do fim do período (Ativo/Passivo)
 * - Average: taxa média do período (Receitas/Despesas/CMV)
 * - Historical: taxa histórica da transação (Patrimônio Líquido)
 */
export const GeneralRateType = Object.freeze({
  Current: 'Current',
  Average: 'Average',
  Historical: 'Historical',
});

/**
 * Mapeamento AccountType → GeneralRateType padrão
 * Baseado nas normas contábeis brasileiras (CPC 02 / IAS 21)
 */
export const ACCOUNT_TYPE_TO_RATE_TYPE = Object.freeze({
  [AccountType.Bank]: GeneralRateType.Current,
  [AccountType.AcctRec]: GeneralRateType.Current,
  [AccountType.OthCurrAsset]: GeneralRateType.Current,
  [AccountType.FixedAsset]: GeneralRateType.Current,
  [AccountType.OthAsset]: GeneralRateType.Current,
  [AccountType.AcctPay]: GeneralRateType.Current,
  [AccountType.OthCurrLiab]: GeneralRateType.Current,
  [AccountType.LongTermLiab]: GeneralRateType.Current,
  [AccountType.Equity]: GeneralRateType.Historical,
  [AccountType.Income]: GeneralRateType.Average,
  [AccountType.COGS]: GeneralRateType.Average,
  [AccountType.Expense]: GeneralRateType.Average,
  [AccountType.DeferRevenue]: GeneralRateType.Current,
  [AccountType.DeferExpense]: GeneralRateType.Current,
  [AccountType.UnbilledRec]: GeneralRateType.Current,
});
