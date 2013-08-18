'use strict';

angular.module('kibana.stats', [])
.controller('stats', function ($scope, querySrv, dashboard, filterSrv)
{
  $scope.panelMeta = {
    editorTabs : [
      {title:'Queries', src:'partials/querySelect.html'}
    ],
    status: "Stable",
    description: "Displays a statistical aggregration (count, total, avg, max, min, terms/distinct count) of a numeric field."
  };

  var _d = {
    queries: {
      mode: 'all',
      ids: [],
      queryString: ""
    },
    field: "",
    statistic: "count",
    decimals: 0,
    decimalSeparator: ".",
    commaSeparator: ",",
    termsCountMax: 100000,
    style: {},
    formatString: "{0}",
    spyable : true,
    valueScript: null
  };

  _.defaults($scope.panel, _d);

  // I really don't like this function, too much dom manip. Break out into directive?
  $scope.populate_modal = function(request) {
    $scope.inspector = angular.toJson(JSON.parse(request.toString()), true);
  };

  $scope.set_refresh = function (state)
  {
    $scope.refresh = state;
  };

  $scope.close_edit = function ()
  {
    if ($scope.refresh)
    {
      $scope.get_data();
    }
    $scope.refresh = false;
    $scope.$emit('render');
  };

  $scope.init = function ()
  {
    $scope.$on('refresh', function ()
    {
      $scope.get_data();
    });
    $scope.get_data();
  };

  $scope.get_data = function (segment, query_id)
  {
    delete $scope.panel.error;

    // Make sure we have everything for the request to complete
    if (dashboard.indices.length === 0) {
      return;
    }

    if ($scope.panel.statistic != "hits" && ($scope.panel.field == null || $scope.panel.field == "")) {
      $scope.panel.error = "Field must be specified.";
      return null;
    }

    $scope.panelMeta.loading = true;

    var request = $scope.ejs.Request().indices(dashboard.indices);

    var facetFilter = querySrv.getFacetFilter(filterSrv, $scope.panel.queries, $scope.panel.queries.queryString);

    var mode = $scope.panel.statistic;

    switch (mode)
    {
      case "count":
        request = request
          .facet($scope.ejs.QueryFacet('stats')
            .query($scope.ejs.QueryStringQuery($scope.panel.field + ":*"))
            .facetFilter(facetFilter)).size(0);
        break;

      case "termscount":
        request = request
         .facet($scope.ejs.TermsFacet('terms')
          .field($scope.panel.field)
          .facetFilter(facetFilter)
          .size($scope.panel.termsCountMax)).size(0);
        break;

      case "hits":
        request = request
          .facet($scope.ejs.QueryFacet('stats')
            .query($scope.ejs.QueryStringQuery("*"))
            .facetFilter(facetFilter)).size(0);
        break;

      default:
        var facet = $scope.ejs.StatisticalFacet('stats')
          .facetFilter(facetFilter);

        if ($scope.panel.valueScript != null && $scope.panel.valueScript != "")
          facet = facet.script($scope.panel.valueScript);
        else
          facet = facet.field($scope.panel.field);

        request = request.facet(facet).size(0);

        break;
    }

    // Populate the inspector panel
    $scope.populate_modal(request);

    var results = request.doSearch();

    results.then(function (results) {
      $scope.panelMeta.loading = false;
      $scope.hits = results.hits.total;

      var scripts = $LAB.script("common/lib/jquery.number.min.js");
      
      scripts.wait(function()
      {
        var statistic = 0;

        switch (mode)
        {
          case "termscount":
            statistic = results.facets.terms.terms.length;
            break;

          case "count":
          case "hits":
            statistic = results.facets.stats.count;
            break;

          default:
            statistic = results.facets.stats[mode];
            break;
        }

        var formatted = $.number(statistic, $scope.panel.decimals, $scope.panel.decimalSeparator, $scope.panel.commaSeparator);
        if (!_.isUndefined($scope.panel.formatString) && $scope.panel.formatString != null && $scope.panel.formatString != "")
          formatted = $scope.panel.formatString.replace(/\{0\}/g, formatted);

        $scope.statistic = formatted;

        $scope.$emit('render');
      });
    });
  };
});