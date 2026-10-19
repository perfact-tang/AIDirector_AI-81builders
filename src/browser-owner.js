let owner='local';
export const browserOwner=()=>owner;
export function setBrowserOwner(uid){owner=uid||'local';}
