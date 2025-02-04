import { ApplicationConfiguration, ExecuteActionableType } from './constants';
import { BLOCK_TYPE_NAME_MAPPING } from '@interfaces/BlockType';
import {
  ButtonActionType,
  ButtonActionTypeEnum,
  CommandCenterActionPageType,
  CommandCenterActionType,
  CommandCenterItemType,
  ItemApplicationType,
  ItemTypeEnum,
  KeyValueType,
  OBJECT_TITLE_MAPPING_SHORT,
  ObjectTypeEnum,
  TYPE_TITLE_MAPPING,
  TYPE_TITLE_MAPPING_NORMAL,
} from '@interfaces/CommandCenterType';
import { CUSTOM_EVENT_NAME_COMMAND_CENTER, CUSTOM_EVENT_NAME_COMMAND_CENTER_OPEN } from '@utils/events/constants';
import { capitalize, stringSimilarity } from '@utils/string';
import { dig, setNested } from '@utils/hash';
import { indexBy, sortByKey } from '@utils/array';
import { queryString } from '@utils/url';

const FILTER_KEYS = ['title', 'description', 'uuid', 'item_type', 'object_type'];

function getSearchableText(item: CommandCenterItemType): string {
  const arr = [];
  FILTER_KEYS.forEach((key) => {
    let value = item?.[key];
    if (value) {
      value = value?.toLowerCase();
      const parts = value?.split('.');
      if (parts?.length === 2) {
        arr.push(parts?.[0]);
        arr.push(parts?.[1]);
      }
      arr.push(value);
    }
  });

  const text = arr?.join(' ') || '';

  return text + ' ' + text?.replaceAll('_', ' ');
}

export function filterItems(
  searchText: string,
  items: CommandCenterItemType[],
): CommandCenterItemType[] {
  if (!searchText) {
    return items;
  }

  const value = (searchText || '')?.toLowerCase();

  return (items || [])?.reduce((acc, item) => {
    // const valueCount = value?.length || 1;
    const text = getSearchableText(item);
    // const score = stringSimilarity(
    //   value,
    //   text,
    //   2,
    // );

    // const threshold = 0.01 * (1 / (valueCount / (valueCount**2)));

    if (text?.includes(value)) {
      // @ts-ignore
      return acc.concat(item);
    }

    return acc;
  }, []);
}

export function rankItems(items: CommandCenterItemType[]): CommandCenterItemType[] {
  return sortByKey(
    items || [],
    ({ score, title }) => `${1 / score}${title}`,
    {
      ascending: true,
    },
  );
}

export function getDisplayCategory(item: CommandCenterItemType, normal: boolean = false): string {
  if (normal) {
    const part1 = TYPE_TITLE_MAPPING_NORMAL[item?.item_type];
    let part2 = OBJECT_TITLE_MAPPING_SHORT[item?.object_type];

    if (ObjectTypeEnum.BLOCK === item?.object_type) {
      part2 = BLOCK_TYPE_NAME_MAPPING[item?.metadata?.block?.type] || part2;
    }

    if (ItemTypeEnum.DETAIL === item?.item_type) {
      return capitalize(part2 || '');
    }

    return [
      part1,
      part2,
    ].join(' ');
  }

  return TYPE_TITLE_MAPPING[item?.item_type];
}

export function updateActionFromUpstreamResults(
  action: CommandCenterActionType,
  results: KeyValueType,
): CommandCenterActionType {
  const {
    upstream_action_value_key_mapping: upstreamActionValueKeyMapping,
  } = action;

  let actionCopy = { ...action };

  if (upstreamActionValueKeyMapping) {
    Object.entries(upstreamActionValueKeyMapping || {})?.forEach(([
      actionUUID,
      mapping,
    ]) => {
      const result = results?.[actionUUID];
      if (result) {
        Object.entries(mapping || {})?.forEach(([
          parentKeyGetter,
          childKeySetter,
        ]) => {
          const value = dig(result, parentKeyGetter);
          setNested(actionCopy, childKeySetter, value);
        });
      }
    });
  }

  return actionCopy;
}

export function executeButtonActions({
  application,
  button,
  executeAction,
  focusedItemIndex,
  item,
  refError,
  removeApplication,
}: {
  application: ItemApplicationType;
  button: ButtonActionType;
  focusedItemIndex: number;
  item: CommandCenterItemType;
  refError: any;
  removeApplication: () => void;
} & ExecuteActionableType) {
  const actionTypes = button?.action_types || [];

  const invokeActionAndCallback = (index: number, results: KeyValueType = {}) => {
    const actionType = actionTypes?.[index];

    let actionFunction = (result: KeyValueType = {}) => {};

    if (ButtonActionTypeEnum.RESET_FORM === actionType) {
      if (typeof window !== 'undefined') {
        const eventCustom = new CustomEvent(CUSTOM_EVENT_NAME_COMMAND_CENTER, {
          detail: {
            actionType: 'reset_form',
            item,
          },
        });

        actionFunction = (result: KeyValueType = {}) => window.dispatchEvent(eventCustom);
      }
    } else if (ButtonActionTypeEnum.EXECUTE === actionType) {
      actionFunction = (result: KeyValueType = {}) => executeAction(item, focusedItemIndex);
    } else if (ButtonActionTypeEnum.CLOSE_APPLICATION === actionType) {
      actionFunction = (result: KeyValueType = {}) => removeApplication();
    } else if (ButtonActionTypeEnum.CUSTOM_ACTIONS === actionType) {
      actionFunction = (result: KeyValueType = {}) => executeAction(
        item,
        focusedItemIndex,
        button?.actions,
      );
    }

    const result = new Promise((resolve, reject) => resolve(actionFunction(results)));

    return result?.then((resultsInner: any) => {
      if (index + 1 <= actionTypes?.length - 1 && !refError?.current) {
        return invokeActionAndCallback(index + 1, {
          ...(results || {}),
          ...(resultsInner || {}),
        });
      }
    });
  };

  if (actionTypes?.length >= 1) {
    return invokeActionAndCallback(0);
  }
}

export function interpolatePagePath(page: CommandCenterActionPageType): string {
  const {
    parameters,
    path,
    query,
  } = page;

  const queryS = query ? queryString(query) : '';
  let pathUse = path;

  Object.entries(parameters || {})?.forEach(([key, value]) => {
    pathUse = pathUse?.replaceAll(`:${key}`, String(value));
  });

  return [pathUse, queryS].filter(s => s).join('?');
}

export function getCurrentApplicationForItem(
  item: CommandCenterItemType,
  applicationsConfigurations: ApplicationConfiguration[],
  opts: {
    beforeAddingNextApplication?: boolean;
  } = {
    beforeAddingNextApplication: false,
  },
): ItemApplicationType {
  const configsForItem = applicationsConfigurations?.filter(({
    item: itemInner,
  }) => itemInner?.uuid === item?.uuid);
  let index = configsForItem?.length || 0;
  if (!opts?.beforeAddingNextApplication) {
    index -= 1;
  }

  return item?.applications?.[index];
}

export function launchCommandCenter() {
  const eventCustom = new CustomEvent(CUSTOM_EVENT_NAME_COMMAND_CENTER_OPEN);

  if (typeof window !== 'undefined') {
    window.dispatchEvent(eventCustom);
  }
}
