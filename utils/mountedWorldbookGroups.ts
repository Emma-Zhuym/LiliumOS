// [EM-START: mounted-worldbook-groups]
import type { MountedWorldbook } from '../types';

const UNGROUPED = '未分类设定 (General)';

/** 角色身上挂的世界书按组排好：组的顺序是第一次挂上的顺序，组内按挂载顺序；没分组的归一组 */
export const groupMountedWorldbooks = (books: MountedWorldbook[]): [string, MountedWorldbook[]][] => {
    const map = new Map<string, MountedWorldbook[]>();
    for (const book of books) {
        const key = book.category?.trim() || UNGROUPED;
        const list = map.get(key);
        if (list) list.push(book); else map.set(key, [book]);
    }
    return [...map.entries()];
};
// [EM-END: mounted-worldbook-groups]
