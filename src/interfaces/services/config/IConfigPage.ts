import IConfigOption from "./IConfigOption";

export default interface IConfigPage {
    options: IConfigOption[];
    page: number;
    pages: number;
    total: number;
    hasPrevious: boolean;
    hasNext: boolean;
}
