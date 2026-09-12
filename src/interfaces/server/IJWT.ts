export interface IJWTPayload {
    sub: string;
    scope?: string[];
    iat: number;
    exp: number;
}
