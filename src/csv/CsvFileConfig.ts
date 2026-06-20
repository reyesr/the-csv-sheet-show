export enum DecimalSeparator {
    DOT,
    COMMAS,
    BOTH
}


export interface CsvFileConfig {
    separator: string;  // usually a single character, `,` `;` `\t` etc
    encoding: string;   // e.g. 'utf-8', 'latin1', etc
    lineEnding: string; // one of the usual 3: \r\n (windows), \n (unix), \r (old mac)
    decimalSeparator: DecimalSeparator; // the decimal separator used in numeric values, if any
    hasHeader: boolean; // whether the first row is a header row
}